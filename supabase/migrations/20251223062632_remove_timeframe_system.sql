/*
  # Remove Timeframe and Soft Closing System

  1. Changes to goal_sessions Table
    - Remove `soft_closing` from status constraint (sessions no longer expire by time)
    - Remove `end_time` column (sessions run until goal reached or user stops)
    - Remove `timeframe_hours` column (no time limits)
    - Remove `timeframe_expired_at` column (no expiration tracking)
    - Remove `trades_open_at_expiration` column (no expiration tracking)

  2. Changes to Triggers
    - Update `update_session_status_on_trade_change()` to remove soft_closing logic
    - Sessions only transition: scanning <-> in_trade
    - Keep weekend protection logic (force_closed_weekend status)

  3. Security
    - No RLS policy changes needed
    - Maintain SECURITY DEFINER for trigger functions

  ## Notes
  - Weekend protection still closes sessions at 5 minutes before market close (Friday 4:55 PM EST)
  - Sessions now run indefinitely until goal achieved, user stopped, or weekend shutdown
  - Keeps all weekend-related statuses: force_closed_weekend
*/

-- ============================================================================
-- STEP 1: Drop timeframe-related columns from goal_sessions
-- ============================================================================

DO $$
BEGIN
  -- Drop end_time column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'end_time'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN end_time;
    RAISE NOTICE 'Dropped column: end_time';
  END IF;

  -- Drop timeframe_hours column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'timeframe_hours'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN timeframe_hours;
    RAISE NOTICE 'Dropped column: timeframe_hours';
  END IF;

  -- Drop timeframe_expired_at column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'timeframe_expired_at'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN timeframe_expired_at;
    RAISE NOTICE 'Dropped column: timeframe_expired_at';
  END IF;

  -- Drop trades_open_at_expiration column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'trades_open_at_expiration'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN trades_open_at_expiration;
    RAISE NOTICE 'Dropped column: trades_open_at_expiration';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Update goal_sessions status constraint to remove soft_closing
-- ============================================================================

-- Drop old constraint
DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  FOR constraint_rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'goal_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%soft_closing%'
  LOOP
    EXECUTE format('ALTER TABLE goal_sessions DROP CONSTRAINT %I', constraint_rec.conname);
    RAISE NOTICE 'Dropped constraint: %', constraint_rec.conname;
  END LOOP;
END $$;

-- Add new constraint without soft_closing
ALTER TABLE goal_sessions
  DROP CONSTRAINT IF EXISTS goal_sessions_status_valid_values,
  ADD CONSTRAINT goal_sessions_status_valid_values
  CHECK (status IN (
    'initializing',
    'scanning',
    'trade_pending',
    'in_trade',
    'goal_achieved',
    'expired',
    'user_stopped',
    'force_closed_weekend'
  ));

-- ============================================================================
-- STEP 3: Update session status trigger to remove soft_closing logic
-- ============================================================================

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_session_status_on_trade_change ON goal_session_trades;
DROP FUNCTION IF EXISTS update_session_status_on_trade_change();

-- Create simplified function without soft_closing logic
CREATE OR REPLACE FUNCTION update_session_status_on_trade_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_trades_count INT;
  v_session_status TEXT;
  v_session_id UUID;
BEGIN
  -- Get the session ID (works for both INSERT and UPDATE)
  IF TG_OP = 'INSERT' THEN
    v_session_id := NEW.goal_session_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_session_id := NEW.goal_session_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Get current session status
  SELECT status INTO v_session_status
  FROM goal_sessions
  WHERE id = v_session_id;

  -- Count open trades for this session
  SELECT COUNT(*) INTO v_open_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = v_session_id
  AND status = 'open';

  -- Update session status based on open trade count
  IF v_open_trades_count > 0 THEN
    -- Has open trades: set to 'in_trade' if currently scanning
    IF v_session_status = 'scanning' THEN
      UPDATE goal_sessions
      SET
        status = 'in_trade',
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Session Status] Changed session % from scanning to in_trade (% open trades)', v_session_id, v_open_trades_count;
    END IF;
  ELSE
    -- No open trades: return to scanning if was in_trade
    IF v_session_status = 'in_trade' THEN
      UPDATE goal_sessions
      SET
        status = 'scanning',
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Session Status] Changed session % from in_trade to scanning (no open trades)', v_session_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER update_session_status_on_trade_change
AFTER INSERT OR UPDATE OF status ON goal_session_trades
FOR EACH ROW
EXECUTE FUNCTION update_session_status_on_trade_change();

-- Update comment to reflect new behavior
COMMENT ON FUNCTION update_session_status_on_trade_change() IS
  'Automatically updates goal session status based on trade activity. Transitions between scanning and in_trade based on open trades. No timeframe expiration logic.';

-- ============================================================================
-- STEP 4: Migrate any existing soft_closing sessions to user_stopped
-- ============================================================================

UPDATE goal_sessions
SET
  status = 'user_stopped',
  updated_at = NOW()
WHERE status = 'soft_closing';