/*
  # Create Session Recovery System - Manual Unstick Functionality
  
  ## Purpose
  Provides users with a manual recovery option when sessions get stuck in problematic states.
  This is a safety valve for when automatic recovery systems fail.
  
  ## What This Creates
  1. `unstick_session()` - Main recovery function that users can call
  2. `get_session_health()` - Diagnostic function to check if session is stuck
  3. Comprehensive logging for debugging stuck sessions
  
  ## How It Works
  - Checks if session is in a stuck state (awaiting_continuation for >5 minutes)
  - Safely transitions session to 'user_stopped' status
  - Dismisses any pending modals
  - Clears all timeout flags
  - Creates notification for user
  - Preserves all trade data and history
  
  ## Safety Features
  - Only allows users to unstick their own sessions
  - Cannot unstick sessions with open trades (must close trades first)
  - Logs all unstick actions for audit trail
  - Validates session ownership
  - Prevents data loss
  
  ## Security
  - SECURITY DEFINER with auth.uid() validation
  - RLS policies ensure user can only access own data
  - Comprehensive error handling
*/

-- ============================================================================
-- Function: Get Session Health Status
-- ============================================================================

CREATE OR REPLACE FUNCTION get_session_health(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_open_trades integer;
  v_minutes_in_state numeric;
  v_is_stuck boolean := false;
  v_stuck_reason text := null;
  v_can_unstick boolean := false;
BEGIN
  -- Get session details
  SELECT
    gs.id,
    gs.user_id,
    gs.status,
    gs.awaiting_continuation_confirmation,
    gs.continuation_confirmation_expires_at,
    gs.scanning_started_at,
    gs.created_at,
    gs.updated_at
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id
    AND gs.user_id = auth.uid();

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Session not found or access denied',
      'is_stuck', false,
      'can_unstick', false
    );
  END IF;

  -- Check for open trades (cannot unstick if trades are open)
  SELECT COUNT(*) INTO v_open_trades
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'open';

  -- Calculate time in current state
  v_minutes_in_state := EXTRACT(EPOCH FROM (now() - v_session.updated_at)) / 60;

  -- Detect stuck conditions
  IF v_session.status = 'awaiting_continuation' AND v_minutes_in_state > 5 THEN
    v_is_stuck := true;
    v_stuck_reason := 'Session stuck in awaiting_continuation for over 5 minutes';
    v_can_unstick := (v_open_trades = 0);
  ELSIF v_session.awaiting_continuation_confirmation 
        AND v_session.continuation_confirmation_expires_at IS NOT NULL
        AND now() > v_session.continuation_confirmation_expires_at + interval '5 minutes' THEN
    v_is_stuck := true;
    v_stuck_reason := 'Continuation modal expired over 5 minutes ago';
    v_can_unstick := (v_open_trades = 0);
  ELSIF v_session.status IN ('scanning', 'trade_pending') AND v_minutes_in_state > 30 THEN
    v_is_stuck := true;
    v_stuck_reason := 'Session scanning/pending for over 30 minutes';
    v_can_unstick := (v_open_trades = 0);
  END IF;

  -- Return health status
  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'is_stuck', v_is_stuck,
    'stuck_reason', v_stuck_reason,
    'can_unstick', v_can_unstick,
    'open_trades', v_open_trades,
    'minutes_in_state', ROUND(v_minutes_in_state, 1),
    'awaiting_continuation', v_session.awaiting_continuation_confirmation,
    'last_updated', v_session.updated_at
  );
END;
$$;

COMMENT ON FUNCTION get_session_health IS
  'Diagnostic function to check if a session is stuck and whether it can be safely unstuck';

-- ============================================================================
-- Function: Unstick Session (Manual Recovery)
-- ============================================================================

CREATE OR REPLACE FUNCTION unstick_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_open_trades integer;
  v_health jsonb;
  v_modal_id uuid;
  v_calculated_pnl numeric;
  v_trades_count integer;
BEGIN
  -- Check session health first
  v_health := get_session_health(p_session_id);

  -- Verify session exists and user has access
  IF v_health->>'error' IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', v_health->>'error'
    );
  END IF;

  -- Check if session is actually stuck
  IF NOT (v_health->>'is_stuck')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session is not in a stuck state',
      'current_status', v_health->>'status'
    );
  END IF;

  -- Check if session can be safely unstuck
  IF NOT (v_health->>'can_unstick')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot unstick session with open trades. Please close all trades first.',
      'open_trades', (v_health->>'open_trades')::integer
    );
  END IF;

  -- Get full session details
  SELECT
    id,
    user_id,
    status,
    target_value,
    scanning_started_at,
    created_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  -- Calculate PnL from trades
  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_calculated_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Count trades
  SELECT COUNT(*)
  INTO v_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id;

  -- Log the unstick action
  RAISE NOTICE '[unstick_session] User % manually unsticking session % (was: %)',
    auth.uid(), p_session_id, v_health->>'status';

  -- Unstick the session
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_session_id
    AND user_id = auth.uid();

  -- Dismiss any pending modals for this session
  UPDATE pending_user_modals
  SET
    dismissed_at = now(),
    user_action = 'unstuck_manually'
  WHERE goal_session_id = p_session_id
    AND user_id = auth.uid()
    AND dismissed_at IS NULL;

  -- Create a notification for the user
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
    p_session_id,
    v_session.user_id,
    'session_ended',
    'medium',
    '🔧 Session Recovered',
    format('Your stuck session was manually recovered. %s trade%s completed. Final: $%s',
      v_trades_count,
      CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
      ROUND(v_calculated_pnl::numeric, 2)),
    jsonb_build_object(
      'close_reason', 'manual_recovery',
      'previous_status', v_health->>'status',
      'stuck_reason', v_health->>'stuck_reason',
      'trades_in_session', v_trades_count,
      'final_pnl', v_calculated_pnl,
      'target_value', v_session.target_value,
      'unstuck_at', now()
    ),
    ARRAY['in_app']
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Session successfully unstuck',
    'session_id', p_session_id,
    'previous_status', v_health->>'status',
    'new_status', 'user_stopped',
    'trades_count', v_trades_count,
    'final_pnl', v_calculated_pnl
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return failure
    RAISE WARNING '[unstick_session] Error unsticking session %: %', p_session_id, SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An error occurred while unsticking the session',
      'details', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION unstick_session IS
  'Manually recovers a stuck session by safely transitioning it to user_stopped status. Only works if no trades are open.';

-- ============================================================================
-- Grant Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_session_health TO authenticated;
GRANT EXECUTE ON FUNCTION unstick_session TO authenticated;

-- ============================================================================
-- Create Index for Monitoring Stuck Sessions
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_goal_sessions_stuck_detection
  ON goal_sessions(status, awaiting_continuation_confirmation, updated_at)
  WHERE status IN ('awaiting_continuation', 'scanning', 'trade_pending');

COMMENT ON INDEX idx_goal_sessions_stuck_detection IS
  'Helps identify potentially stuck sessions for monitoring and recovery';
