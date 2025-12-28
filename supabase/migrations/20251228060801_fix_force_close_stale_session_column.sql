/*
  # Fix force_close_stale_session and create_session_ended_modal Column References

  1. Problem
    - force_close_stale_session and create_session_ended_modal reference `gs.goal_amount`
    - The actual column name is `target_value`
    - Causes error: column gs.goal_amount does not exist

  2. Solution
    - Update both functions to use `target_value` instead of `goal_amount`
    - Maintain all other logic intact

  3. Security
    - All functions maintain SECURITY DEFINER
    - No changes to permissions or RLS
*/

-- ============================================================================
-- Fix force_close_stale_session
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

  -- Force close the session
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
  'Allows users to force-close their own stale sessions. Creates session_ended modal for feedback. Fixed to use target_value column.';

-- ============================================================================
-- Fix create_session_ended_modal
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
  -- Get session details (FIXED: Use target_value instead of goal_amount)
  SELECT
    gs.user_id,
    gs.target_value,
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

  -- Calculate session duration in minutes
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
      'target_value', v_session.target_value,
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
  'Creates a persistent modal to inform users their session ended while they were away. Prevents duplicates. Fixed to use target_value column.';

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION force_close_stale_session TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO service_role;
