/*
  # Simplify Scanning to 15-Minute Confirmation System

  1. Overview
    - Replace complex state machine (active/cooldown/lockdown) with simple 15-minute timer
    - Show user confirmation modal after 15 minutes if no trade found
    - 1-minute auto-timeout if user doesn't respond
    - Same rules for all users (no admin bypass)

  2. New Simple Fields
    - scanning_started_at: When current scanning period began
    - scanning_duration_minutes: Duration before showing modal (default 15)
    - awaiting_continuation_confirmation: Flag when modal is shown
    - continuation_confirmation_expires_at: 1-minute timeout for modal

  3. Removed Complex Fields
    - All scanning cycle/session tracking fields
    - Cooldown and lockdown fields
    - Admin bypass flags

  4. New Status
    - 'awaiting_continuation' added to status enum

  5. Security
    - RLS policies unchanged
    - All users follow same rules
*/

-- ============================================================================
-- STEP 1: Add new simplified scanning fields
-- ============================================================================

DO $$
BEGIN
  -- When current scanning period started
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scanning_started_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scanning_started_at timestamptz;

    COMMENT ON COLUMN goal_sessions.scanning_started_at IS
      'When the current 15-minute scanning period started. Reset when user continues.';
  END IF;

  -- How long to scan before showing modal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scanning_duration_minutes'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scanning_duration_minutes integer DEFAULT 15;

    COMMENT ON COLUMN goal_sessions.scanning_duration_minutes IS
      'Minutes to scan before showing continuation modal (default: 15)';
  END IF;

  -- Flag when modal is shown
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'awaiting_continuation_confirmation'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN awaiting_continuation_confirmation boolean DEFAULT false;

    COMMENT ON COLUMN goal_sessions.awaiting_continuation_confirmation IS
      'True when showing "Continue Scanning?" modal to user';
  END IF;

  -- Timeout for modal response
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'continuation_confirmation_expires_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN continuation_confirmation_expires_at timestamptz;

    COMMENT ON COLUMN goal_sessions.continuation_confirmation_expires_at IS
      '1-minute timeout for user to respond to continuation modal. Auto-close if exceeded.';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Update status enum to include 'awaiting_continuation'
-- ============================================================================

DO $$
BEGIN
  -- Check if status constraint exists and includes awaiting_continuation
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'goal_sessions' AND column_name = 'status'
  ) THEN
    -- Drop old constraint
    ALTER TABLE goal_sessions DROP CONSTRAINT IF EXISTS goal_sessions_status_check;
  END IF;

  -- Add new constraint with awaiting_continuation status
  ALTER TABLE goal_sessions
  ADD CONSTRAINT goal_sessions_status_check
  CHECK (status IN (
    'initializing',
    'scanning',
    'trade_pending',
    'in_trade',
    'soft_closing',
    'awaiting_continuation',
    'goal_achieved',
    'expired',
    'user_stopped'
  ));
END $$;

-- ============================================================================
-- STEP 3: Remove old complex scanning cycle fields
-- ============================================================================

DO $$
BEGIN
  -- Remove session tracking
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS scanning_session_number CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS scanning_session_started_at CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS scanning_session_ends_at CASCADE;

  -- Remove cooldown tracking
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS cooldown_started_at CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS cooldown_ends_at CASCADE;

  -- Remove lockdown tracking
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS lockdown_started_at CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS lockdown_ends_at CASCADE;

  -- Remove scan counters
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS total_scans_in_cycle CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS scans_in_current_session CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS last_scan_at CASCADE;

  -- Remove configuration
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS max_scans_per_session CASCADE;
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS scan_interval_seconds CASCADE;

  -- Remove state management
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS scanning_cycle_status CASCADE;

  -- Remove admin bypass
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS unlimited_scanning CASCADE;

  -- Remove cycle tracking
  ALTER TABLE goal_sessions DROP COLUMN IF EXISTS cycle_started_at CASCADE;
END $$;

-- ============================================================================
-- STEP 4: Clean up existing sessions
-- ============================================================================

-- Convert any sessions that were in old states to appropriate new states
UPDATE goal_sessions
SET status = 'user_stopped',
    end_time = now()
WHERE status NOT IN (
  'initializing',
  'scanning',
  'trade_pending',
  'in_trade',
  'soft_closing',
  'goal_achieved',
  'expired',
  'user_stopped'
);

-- Initialize scanning_started_at for active sessions
UPDATE goal_sessions
SET scanning_started_at = COALESCE(start_time, now())
WHERE status IN ('scanning', 'trade_pending')
  AND scanning_started_at IS NULL;

-- ============================================================================
-- STEP 5: Create helper functions for new scanning logic
-- ============================================================================

-- Check how many minutes have elapsed since scanning started
CREATE OR REPLACE FUNCTION get_scanning_elapsed_minutes(p_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_elapsed_minutes integer;
BEGIN
  SELECT EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60
  INTO v_elapsed_minutes
  FROM goal_sessions
  WHERE id = p_session_id;

  RETURN COALESCE(v_elapsed_minutes, 0);
END;
$$;

COMMENT ON FUNCTION get_scanning_elapsed_minutes IS
  'Returns minutes elapsed since scanning_started_at for a session';

-- Check if we should show the continuation modal
CREATE OR REPLACE FUNCTION should_show_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_elapsed_minutes integer;
  v_has_trades boolean;
BEGIN
  -- Get session details
  SELECT
    scanning_started_at,
    scanning_duration_minutes,
    awaiting_continuation_confirmation,
    status
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Not applicable if session not found or not in scanning status
  IF v_session IS NULL OR v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN false;
  END IF;

  -- Already showing modal
  IF v_session.awaiting_continuation_confirmation THEN
    RETURN false;
  END IF;

  -- Check if scanning started
  IF v_session.scanning_started_at IS NULL THEN
    RETURN false;
  END IF;

  -- Calculate elapsed time
  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60;

  -- Check if any trades were found during this period
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades
    WHERE goal_session_id = p_session_id
      AND created_at >= v_session.scanning_started_at
  ) INTO v_has_trades;

  -- Show modal if: elapsed time >= duration AND no trades found
  RETURN v_elapsed_minutes >= v_session.scanning_duration_minutes AND NOT v_has_trades;
END;
$$;

COMMENT ON FUNCTION should_show_continuation_modal IS
  'Returns true if session has been scanning for 15+ minutes without finding a trade';

-- Trigger the continuation modal
CREATE OR REPLACE FUNCTION trigger_continuation_modal(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_confirmation = true,
    continuation_confirmation_expires_at = now() + interval '1 minute'
  WHERE id = p_session_id
    AND status IN ('scanning', 'trade_pending');
END;
$$;

COMMENT ON FUNCTION trigger_continuation_modal IS
  'Sets session to awaiting_continuation status and starts 1-minute timeout';

-- Handle user response to continuation modal
CREATE OR REPLACE FUNCTION handle_continuation_response(
  p_session_id uuid,
  p_continue_scanning boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_continue_scanning THEN
    -- User chose to continue - reset timer and resume scanning
    UPDATE goal_sessions
    SET
      status = 'scanning',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      scanning_started_at = now(),
      last_scan_time = now()
    WHERE id = p_session_id
      AND status = 'awaiting_continuation';
  ELSE
    -- User chose to stop - end session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      end_time = now()
    WHERE id = p_session_id
      AND status = 'awaiting_continuation';
  END IF;
END;
$$;

COMMENT ON FUNCTION handle_continuation_response IS
  'Processes user choice: continue scanning (reset timer) or stop session';

-- Check and handle modal timeout
CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_timed_out boolean := false;
BEGIN
  SELECT
    awaiting_continuation_confirmation,
    continuation_confirmation_expires_at,
    status
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Check if awaiting confirmation and timeout has passed
  IF v_session.awaiting_continuation_confirmation
     AND v_session.continuation_confirmation_expires_at IS NOT NULL
     AND now() > v_session.continuation_confirmation_expires_at
     AND v_session.status = 'awaiting_continuation'
  THEN
    -- Timeout - auto-close session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      end_time = now()
    WHERE id = p_session_id;

    v_timed_out := true;
  END IF;

  RETURN v_timed_out;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'Checks if continuation modal has timed out (1 minute) and auto-closes session if so';

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_scanning_elapsed_minutes TO authenticated;
GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_response TO authenticated;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO authenticated;
