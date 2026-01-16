/*
  # Fix Alpha Thoughts RLS and UI Display Issues

  ## Problems Fixed
  1. Alpha thoughts not displaying - RLS policy blocked client-side insertions
  2. Scan history showing during active trades - needs conditional hiding
  3. Database constraint violation when closing trades

  ## Changes
  1. **Alpha Scan Thoughts RLS Fix**
     - The existing policy only allowed service_role to insert
     - Goal scanner runs client-side with authenticated user token
     - Add policy allowing authenticated users to insert their own thoughts

  2. **No database changes needed for UI fixes**
     - Scan history hiding is a frontend-only change
     - Will be handled in component

  3. **Investigate constraint violation**
     - Check what status is being set during trade closure
     - Ensure trigger doesn't create invalid session status
*/

-- ============================================================================
-- STEP 1: Fix alpha_scan_thoughts RLS to allow client-side insertions
-- ============================================================================

-- Drop the restrictive service_role-only insert policy
DROP POLICY IF EXISTS "Service role can insert scan thoughts" ON alpha_scan_thoughts;

-- The authenticated user policy already exists from the original migration
-- But let's make sure it's correctly defined
DROP POLICY IF EXISTS "Users can insert own scan thoughts" ON alpha_scan_thoughts;

-- Recreate with explicit policy allowing authenticated users to insert their own thoughts
CREATE POLICY "Authenticated users can insert own scan thoughts"
  ON alpha_scan_thoughts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Also allow service_role for server-side operations
CREATE POLICY "Service role can insert any scan thought"
  ON alpha_scan_thoughts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================================
-- STEP 2: Add logging to track where status violations occur
-- ============================================================================

-- Add a function to log constraint violations
CREATE OR REPLACE FUNCTION log_status_violation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Log when an invalid status is attempted
  IF NEW.status NOT IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'soft_closing', 'goal_achieved', 'expired', 'user_stopped') THEN
    RAISE WARNING '[goal_sessions] Invalid status attempted: % for session %', NEW.status, NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Add trigger to log violations BEFORE they happen
DROP TRIGGER IF EXISTS before_goal_session_status_update ON goal_sessions;
CREATE TRIGGER before_goal_session_status_update
  BEFORE INSERT OR UPDATE OF status
  ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION log_status_violation();

COMMENT ON FUNCTION log_status_violation() IS
  'Logs when invalid goal_sessions status values are attempted. Helps debug constraint violations.';

-- ============================================================================
-- STEP 3: Add better error handling to price trigger
-- ============================================================================

-- Update the price trigger to be more fault-tolerant
CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_position RECORD;
  v_session RECORD;
  v_current_price NUMERIC;
  v_should_close_at_sl BOOLEAN;
  v_should_close_at_tp BOOLEAN;
  v_close_reason TEXT;
  v_close_price NUMERIC;
  v_error_message TEXT;
  v_total_session_pnl NUMERIC;
  v_goal_target NUMERIC;
  v_closed_trades_pnl NUMERIC;
  v_calculated_pnl NUMERIC;
  v_goal_achieved BOOLEAN;
BEGIN
  -- Only process INSERT operations
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Find all open positions for this symbol
  FOR v_position IN
    SELECT *
    FROM goal_session_trades
    WHERE symbol = NEW.symbol
      AND status = 'open'
      AND stop_loss IS NOT NULL
      AND take_profit IS NOT NULL
  LOOP
    BEGIN
      -- Determine current price based on direction
      IF v_position.direction = 'buy' THEN
        v_current_price := NEW.bid::numeric;
      ELSE
        v_current_price := NEW.ask::numeric;
      END IF;

      -- Check if SL or TP should trigger
      IF v_position.direction = 'buy' THEN
        v_should_close_at_sl := v_current_price <= v_position.stop_loss;
        v_should_close_at_tp := v_current_price >= v_position.take_profit;
      ELSE
        v_should_close_at_sl := v_current_price >= v_position.stop_loss;
        v_should_close_at_tp := v_current_price <= v_position.take_profit;
      END IF;

      -- Close position if SL or TP triggered
      IF v_should_close_at_sl THEN
        v_close_reason := 'stop_loss';
        v_close_price := v_position.stop_loss;

        RAISE NOTICE 'Database trigger closing position % at SL: % (current: %)',
          v_position.id, v_close_price, v_current_price;

        -- Close the position using the RPC function
        PERFORM close_goal_session_trade(
          v_position.id,
          v_close_price,
          v_close_reason,
          v_position.goal_session_id
        );

        -- Create notification
        INSERT INTO goal_notifications (
          goal_session_id,
          user_id,
          type,
          priority,
          title,
          message,
          metadata,
          channels
        ) VALUES (
          v_position.goal_session_id,
          v_position.user_id,
          'trade_closed',
          'urgent',
          'Stop Loss Hit (Database Trigger)',
          format('Database trigger closed %s at stop loss. Price: %s', v_position.symbol, v_close_price),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'close_price', v_close_price,
            'current_price', v_current_price,
            'closed_by', 'database_trigger'
          ),
          ARRAY['in_app']
        );

      ELSIF v_should_close_at_tp THEN
        v_close_reason := 'take_profit';
        v_close_price := v_position.take_profit;

        RAISE NOTICE 'Database trigger closing position % at TP: % (current: %)',
          v_position.id, v_close_price, v_current_price;

        -- Close the position
        PERFORM close_goal_session_trade(
          v_position.id,
          v_close_price,
          v_close_reason,
          v_position.goal_session_id
        );

        -- Create notification
        INSERT INTO goal_notifications (
          goal_session_id,
          user_id,
          type,
          priority,
          title,
          message,
          metadata,
          channels
        ) VALUES (
          v_position.goal_session_id,
          v_position.user_id,
          'trade_closed',
          'high',
          'Take Profit Hit (Database Trigger)',
          format('Database trigger closed %s at take profit. Price: %s', v_position.symbol, v_close_price),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'close_price', v_close_price,
            'current_price', v_current_price,
            'closed_by', 'database_trigger'
          ),
          ARRAY['in_app']
        );
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Log error but don't fail the entire trigger
      GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
      RAISE WARNING '[RealtimeSLTP] Error processing position %: %', v_position.id, v_error_message;
      -- Continue to next position
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'Automatically checks and closes open positions when SL or TP is hit. Includes error handling to prevent cascade failures.';

