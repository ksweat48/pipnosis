/*
  # CCIP Continuation Functions SSOT Compliance Fix - Drop & Recreate

  This migration drops the old continuation functions to fix the 400 errors
  caused by references to dropped columns (awaiting_continuation_confirmation, etc).
  
  Then recreates them using ONLY SSOT pattern:
  - status = 'awaiting_continuation' (the state)
  - awaiting_continuation_since (when state entered)
*/

-- ============================================================================
-- STEP 1: Drop Existing Functions (to allow return type change)
-- ============================================================================

DROP FUNCTION IF EXISTS handle_continuation_response(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS check_continuation_modal_timeout(uuid) CASCADE;
DROP FUNCTION IF EXISTS force_close_stale_session(uuid) CASCADE;

-- ============================================================================
-- STEP 2: Recreate handle_continuation_response - SSOT Compliance
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_continuation_response(
  p_session_id uuid,
  p_continue_scanning boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_current_pnl numeric;
  v_target_profit numeric;
  v_remaining_gap numeric;
BEGIN
  -- SSOT: Get session using status-based logic (NO awaiting_continuation_confirmation column)
  SELECT 
    id, 
    user_id, 
    status, 
    awaiting_continuation_since,
    current_pnl,
    target_profit,
    (target_profit - current_pnl) as remaining_gap
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RAISE NOTICE '[handle_continuation_response] Session % not found or not owned by user', p_session_id;
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- SSOT: Check continuation state using status column
  IF v_session.status != 'awaiting_continuation' THEN
    RAISE NOTICE '[handle_continuation_response] Session % not in awaiting_continuation status', p_session_id;
    RETURN jsonb_build_object('success', false, 'error', 'not_awaiting_continuation');
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
    -- User wants to continue - reset to scanning (SSOT: only update status)
    UPDATE goal_sessions
    SET
      status = 'scanning',
      scanning_started_at = now(),
      awaiting_continuation_since = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[handle_continuation_response] Session % continuing to scan for remaining $%', 
      p_session_id, ROUND(v_remaining_gap::numeric, 2);
      
    RETURN jsonb_build_object(
      'success', true,
      'action', 'continue_scanning',
      'remaining_gap', ROUND(v_remaining_gap::numeric, 2)
    );
  ELSE
    -- User wants to stop - close the session (SSOT: update status + clear timestamp)
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_since = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    -- Create session_ended modal for feedback
    v_modal_id := create_session_ended_modal(p_session_id, 'user_accepted_results');

    RAISE NOTICE '[handle_continuation_response] Session % closed by user choice, achieved $%, goal $%', 
      p_session_id, ROUND(v_session.current_pnl::numeric, 2), ROUND(v_session.target_profit::numeric, 2);
      
    RETURN jsonb_build_object(
      'success', true,
      'action', 'close_session',
      'achieved_profit', ROUND(v_session.current_pnl::numeric, 2),
      'target_profit', ROUND(v_session.target_profit::numeric, 2),
      'modal_id', v_modal_id
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION handle_continuation_response IS
  'SSOT: Handles user response to continuation modal. Uses ONLY status column (awaiting_continuation) and awaiting_continuation_since.';

GRANT EXECUTE ON FUNCTION handle_continuation_response TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_response TO service_role;

-- ============================================================================
-- STEP 3: Recreate check_continuation_modal_timeout - SSOT Compliance
-- ============================================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_timed_out boolean := false;
  v_modal_id uuid;
  v_seconds_elapsed numeric;
BEGIN
  -- SSOT: Get session using only status column
  SELECT
    status,
    awaiting_continuation_since,
    scanning_started_at,
    user_id,
    current_pnl,
    target_profit
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- SSOT Check #1: Timeout for sessions in awaiting_continuation status beyond 60 seconds
  IF v_session.status = 'awaiting_continuation'
     AND v_session.awaiting_continuation_since IS NOT NULL
     AND now() > v_session.awaiting_continuation_since + interval '60 seconds'
  THEN
    v_seconds_elapsed := EXTRACT(EPOCH FROM (now() - v_session.awaiting_continuation_since));
    
    RAISE NOTICE '[check_continuation_modal_timeout] Session % timed out after % seconds', 
      p_session_id, ROUND(v_seconds_elapsed::numeric, 1);

    -- SSOT: Close the session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_since = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    -- Dismiss any pending continuation modal
    UPDATE pending_user_modals
    SET
      dismissed_at = now(),
      user_action = 'auto_closed_timeout'
    WHERE goal_session_id = p_session_id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL;

    -- Create session_ended modal
    v_modal_id := create_session_ended_modal(p_session_id, 'timeout');

    v_timed_out := true;
    
    RETURN jsonb_build_object(
      'success', true,
      'timed_out', true,
      'reason', 'continuation_timeout',
      'seconds_elapsed', ROUND(v_seconds_elapsed::numeric, 1),
      'modal_id', v_modal_id
    );
  END IF;

  -- Safety net: Session scanning >20 min without trade
  IF NOT v_timed_out
     AND v_session.status IN ('scanning', 'trade_pending')
     AND v_session.scanning_started_at IS NOT NULL
     AND EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60 > 20
  THEN
    -- Check if any trades found
    IF NOT EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = p_session_id
        AND gst.created_at >= v_session.scanning_started_at
    ) THEN
      RAISE NOTICE '[check_continuation_modal_timeout] Session % safety net triggered - scanning >20min', p_session_id;

      -- SSOT: Close the session
      UPDATE goal_sessions
      SET
        status = 'user_stopped',
        awaiting_continuation_since = NULL,
        completed_at = now(),
        updated_at = now()
      WHERE id = p_session_id;

      -- Create session_ended modal
      v_modal_id := create_session_ended_modal(p_session_id, 'safety_net');

      v_timed_out := true;
      
      RETURN jsonb_build_object(
        'success', true,
        'timed_out', true,
        'reason', 'safety_net_no_trades',
        'modal_id', v_modal_id
      );
    END IF;
  END IF;

  IF NOT v_timed_out THEN
    RETURN jsonb_build_object('success', true, 'timed_out', false);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_error');
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'SSOT: Checks if continuation timeout exceeded (60 seconds). Uses ONLY status and awaiting_continuation_since.';

GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO service_role;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO authenticated;

-- ============================================================================
-- STEP 4: Recreate force_close_stale_session - SSOT Compliance
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_stale_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
BEGIN
  -- SSOT: Get session
  SELECT id, user_id, status, scanning_started_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- Only close if in an active status
  IF v_session.status NOT IN ('scanning', 'trade_pending', 'awaiting_continuation', 'initializing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_in_active_state');
  END IF;

  -- SSOT: Force close
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    awaiting_continuation_since = NULL,
    completed_at = now(),
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

  -- Create session_ended modal
  v_modal_id := create_session_ended_modal(p_session_id, 'user_stopped');

  RAISE NOTICE '[force_close_stale_session] Session % force closed by user %', p_session_id, auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'modal_id', v_modal_id
  );
END;
$$;

COMMENT ON FUNCTION force_close_stale_session IS
  'SSOT: Force-closes user sessions. Uses ONLY status column.';

GRANT EXECUTE ON FUNCTION force_close_stale_session TO authenticated;
GRANT EXECUTE ON FUNCTION force_close_stale_session TO service_role;

-- ============================================================================
-- STEP 5: Update RPC wrapper functions to handle new return type
-- ============================================================================

-- Create wrapper for backward compatibility if needed
CREATE OR REPLACE FUNCTION handle_continuation_response_v1(
  p_session_id uuid,
  p_continue_scanning boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := handle_continuation_response(p_session_id, p_continue_scanning);
  RETURN (v_result->>'success')::boolean;
END;
$$;

COMMENT ON FUNCTION handle_continuation_response_v1 IS 'Backward compatibility wrapper - returns boolean instead of jsonb';
GRANT EXECUTE ON FUNCTION handle_continuation_response_v1 TO authenticated;

-- ============================================================================
-- STEP 6: Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '[SSOT Fix] ✅ Continuation functions recreated:';
  RAISE NOTICE '  ✅ handle_continuation_response - SSOT compliant';
  RAISE NOTICE '  ✅ check_continuation_modal_timeout - SSOT compliant';
  RAISE NOTICE '  ✅ force_close_stale_session - SSOT compliant';
  RAISE NOTICE '[SSOT Fix] ✅ All functions now use:';
  RAISE NOTICE '    - status = awaiting_continuation (not boolean flag)';
  RAISE NOTICE '    - awaiting_continuation_since (timestamp)';
  RAISE NOTICE '[SSOT Fix] ✅ No references to dropped columns';
END $$;
