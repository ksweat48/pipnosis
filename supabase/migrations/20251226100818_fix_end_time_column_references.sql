/*
  # Fix end_time Column References in Continuation Functions

  1. Problem
    - Migration 20251223062632 removed the `end_time` column from goal_sessions
    - Several continuation functions still reference this column
    - Causes error: column "end_time" of relation "goal_sessions" does not exist

  2. Solution
    - Update handle_continuation_response to remove end_time references
    - Update check_continuation_modal_timeout to remove end_time references
    - Update force_close_stale_session to remove end_time references
    - Update create_session_ended_modal to use completed_at instead of end_time

  3. Changes
    - Remove all "end_time = now()" statements from UPDATE queries
    - Replace "end_time" with "completed_at" in SELECT queries
    - Keep all other logic intact (status updates, flags, etc.)

  4. Security
    - All functions maintain SECURITY DEFINER
    - No changes to permissions or RLS
*/

-- ============================================================================
-- STEP 1: Update handle_continuation_response
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_continuation_response(
  p_session_id uuid,
  p_continue_scanning boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
BEGIN
  -- Get session and verify ownership
  SELECT id, user_id, status, awaiting_continuation_confirmation
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RAISE NOTICE '[handle_continuation_response] Session % not found or not owned by user', p_session_id;
    RETURN false;
  END IF;

  -- Only process if awaiting continuation
  IF NOT v_session.awaiting_continuation_confirmation THEN
    RAISE NOTICE '[handle_continuation_response] Session % not awaiting continuation', p_session_id;
    RETURN false;
  END IF;

  -- Dismiss any pending continuation modal first
  UPDATE pending_user_modals
  SET
    dismissed_at = now(),
    user_action = CASE WHEN p_continue_scanning THEN 'continue' ELSE 'close' END
  WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NULL;

  IF p_continue_scanning THEN
    -- User wants to continue - reset scanning timer
    UPDATE goal_sessions
    SET
      status = 'scanning',
      scanning_started_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[handle_continuation_response] Session % continuing to scan', p_session_id;
  ELSE
    -- User wants to stop - close the session (removed end_time)
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[handle_continuation_response] Session % closed by user choice', p_session_id;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION handle_continuation_response IS
  'Handles user response to continuation modal. If continuing, resets scan timer. If stopping, closes session. Updated to use completed_at instead of removed end_time column.';

-- ============================================================================
-- STEP 2: Update check_continuation_modal_timeout
-- ============================================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_timed_out boolean := false;
  v_modal_id uuid;
BEGIN
  SELECT
    awaiting_continuation_confirmation,
    continuation_confirmation_expires_at,
    status,
    scanning_started_at,
    user_id
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Check #1: Standard timeout (awaiting_continuation with expired timestamp)
  IF v_session.awaiting_continuation_confirmation
     AND v_session.continuation_confirmation_expires_at IS NOT NULL
     AND now() > v_session.continuation_confirmation_expires_at
     AND v_session.status IN ('awaiting_continuation', 'scanning', 'trade_pending')
  THEN
    RAISE NOTICE '[check_continuation_modal_timeout] Session % timed out - auto-closing', p_session_id;

    -- Close the session (removed end_time)
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    -- Dismiss any pending continuation modal
    UPDATE pending_user_modals
    SET
      dismissed_at = now(),
      user_action = 'auto_closed'
    WHERE goal_session_id = p_session_id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL;

    -- Create session_ended modal so user sees feedback when they return
    v_modal_id := create_session_ended_modal(p_session_id, 'timeout');

    v_timed_out := true;
  END IF;

  -- Check #2: Safety net - session scanning >20 min without trade and no modal
  IF NOT v_timed_out
     AND v_session.status IN ('scanning', 'trade_pending')
     AND v_session.scanning_started_at IS NOT NULL
     AND NOT v_session.awaiting_continuation_confirmation
     AND EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60 > 20
  THEN
    -- Check if any trades found
    IF NOT EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = p_session_id
        AND gst.created_at >= v_session.scanning_started_at
    ) THEN
      RAISE NOTICE '[check_continuation_modal_timeout] Session % safety net triggered - scanning >20min', p_session_id;

      -- Close the session (removed end_time)
      UPDATE goal_sessions
      SET
        status = 'user_stopped',
        awaiting_continuation_confirmation = false,
        continuation_confirmation_expires_at = NULL,
        completed_at = now(),
        updated_at = now()
      WHERE id = p_session_id;

      -- Create session_ended modal so user sees feedback when they return
      v_modal_id := create_session_ended_modal(p_session_id, 'safety_net');

      v_timed_out := true;
    END IF;
  END IF;

  RETURN v_timed_out;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'Checks if continuation modal has timed out (1 minute) and auto-closes session. Creates session_ended modal for user feedback. Also includes 20-minute safety net for stuck sessions. Updated to use completed_at instead of removed end_time column.';

-- ============================================================================
-- STEP 3: Update force_close_stale_session
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_stale_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
BEGIN
  -- Get session and verify ownership
  SELECT id, user_id, status, scanning_started_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Only close if in an active status
  IF v_session.status NOT IN ('scanning', 'trade_pending', 'awaiting_continuation', 'initializing') THEN
    RETURN false;
  END IF;

  -- Force close the session (removed end_time)
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  -- Dismiss any pending continuation modal
  UPDATE pending_user_modals
  SET
    dismissed_at = now(),
    user_action = 'force_closed'
  WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NULL;

  -- Create session_ended modal for feedback
  v_modal_id := create_session_ended_modal(p_session_id, 'user_stopped');

  RAISE NOTICE '[force_close_stale_session] Session % force closed by user, modal_id=%', p_session_id, v_modal_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION force_close_stale_session IS
  'Allows users to force-close their own stale sessions. Creates session_ended modal for feedback. Updated to use completed_at instead of removed end_time column.';

-- ============================================================================
-- STEP 4: Update create_session_ended_modal
-- ============================================================================

CREATE OR REPLACE FUNCTION create_session_ended_modal(
  p_session_id uuid,
  p_close_reason text DEFAULT 'timeout'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_duration_minutes numeric;
  v_trade_count integer;
BEGIN
  -- Get session details (use completed_at instead of end_time)
  SELECT
    gs.user_id,
    gs.goal_amount,
    gs.current_pnl,
    gs.scanning_started_at,
    gs.start_time,
    gs.created_at,
    gs.status,
    gs.completed_at
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Get trade count
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_trades
  WHERE goal_session_id = p_session_id;

  -- Calculate session duration in minutes (use completed_at instead of end_time)
  v_duration_minutes := EXTRACT(EPOCH FROM (
    COALESCE(v_session.completed_at, now()) -
    COALESCE(v_session.scanning_started_at, v_session.start_time, v_session.created_at)
  )) / 60;

  -- Check if a session_ended modal already exists for this session
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'session_ended'
      AND dismissed_at IS NULL
  ) THEN
    -- Already exists, don't create duplicate
    RETURN NULL;
  END IF;

  -- Create persistent session_ended modal
  INSERT INTO pending_user_modals (
    user_id,
    goal_session_id,
    modal_type,
    modal_data,
    expires_at
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'session_ended',
    jsonb_build_object(
      'session_id', p_session_id,
      'close_reason', p_close_reason,
      'duration_minutes', ROUND(v_duration_minutes::numeric, 1),
      'trades_in_session', v_trade_count,
      'current_progress', COALESCE(v_session.current_pnl, 0),
      'target_value', v_session.goal_amount,
      'final_status', v_session.status,
      'timestamp', now(),
      'message', CASE
        WHEN p_close_reason = 'timeout' THEN
          'Your session closed automatically because no response was received within the 60-second window.'
        WHEN p_close_reason = 'safety_net' THEN
          'Your session closed automatically after 20 minutes of scanning without finding a trade.'
        WHEN p_close_reason = 'user_stopped' THEN
          'Your session was closed as requested.'
        ELSE
          'Your session has ended.'
      END
    ),
    now() + interval '7 days'  -- Modal expires in 7 days
  )
  RETURNING id INTO v_modal_id;

  RAISE NOTICE '[create_session_ended_modal] Created modal % for session % (reason: %)',
    v_modal_id, p_session_id, p_close_reason;

  RETURN v_modal_id;
END;
$$;

COMMENT ON FUNCTION create_session_ended_modal IS
  'Creates a persistent modal to inform users their session ended while they were away. Prevents duplicates. Updated to use completed_at instead of removed end_time column.';

-- ============================================================================
-- STEP 5: Grant permissions (re-grant to ensure consistency)
-- ============================================================================

GRANT EXECUTE ON FUNCTION handle_continuation_response TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_response TO service_role;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO authenticated;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO service_role;
GRANT EXECUTE ON FUNCTION force_close_stale_session TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO service_role;
