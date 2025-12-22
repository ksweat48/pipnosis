/*
  # Fix Column Reference: goal_amount -> target_value

  ## Problem
  Database functions are referencing `gs.goal_amount` which doesn't exist.
  The actual column name in goal_sessions table is `target_value`.

  ## Solution
  Recreate affected functions with correct column name:
  - trigger_continuation_modal
  - create_session_ended_modal

  ## Security
  - SECURITY DEFINER preserved
  - All permissions maintained
*/

-- ============================================================================
-- Fix trigger_continuation_modal function
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_continuation_modal(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_notification_id uuid;
BEGIN
  -- Get session details (FIXED: goal_amount -> target_value)
  SELECT
    gs.user_id,
    gs.target_value,
    gs.current_pnl,
    gs.status,
    COUNT(gt.id) as trade_count
  INTO v_session
  FROM goal_sessions gs
  LEFT JOIN goal_trades gt ON gt.goal_session_id = gs.id
  WHERE gs.id = p_session_id
  GROUP BY gs.id, gs.user_id, gs.target_value, gs.current_pnl, gs.status;

  -- Only proceed if session is in scanning or trade_pending status
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN;
  END IF;

  -- Update session status
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_confirmation = true,
    continuation_confirmation_expires_at = now() + interval '1 minute'
  WHERE id = p_session_id;

  -- Create persistent modal record
  INSERT INTO pending_user_modals (
    user_id,
    goal_session_id,
    modal_type,
    modal_data,
    expires_at
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'continuation',
    jsonb_build_object(
      'session_id', p_session_id,
      'trades_in_session', COALESCE(v_session.trade_count, 0),
      'current_progress', COALESCE(v_session.current_pnl, 0),
      'target_value', v_session.target_value,
      'continuation_prompt', 'No trade opportunities found in the last 15 minutes. Would you like to continue scanning or close this session?',
      'timestamp', now()
    ),
    now() + interval '24 hours'  -- Modal expires in 24 hours
  )
  RETURNING id INTO v_modal_id;

  -- Create notification record
  INSERT INTO goal_notifications (
    user_id,
    goal_session_id,
    type,
    message,
    priority,
    viewed,
    metadata
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'scanning_timeout',
    format(
      'Scanning paused after 15 minutes with %s trades. Continue or close session?',
      COALESCE(v_session.trade_count, 0)
    ),
    'high',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'session_id', p_session_id,
      'trades_count', COALESCE(v_session.trade_count, 0),
      'current_pnl', COALESCE(v_session.current_pnl, 0),
      'target', v_session.target_value
    )
  )
  RETURNING id INTO v_notification_id;

  -- Trigger push notification via database notification
  -- This will be picked up by the send-push-notification edge function
  PERFORM pg_notify(
    'push_notification_request',
    json_build_object(
      'user_id', v_session.user_id,
      'notification_id', v_notification_id,
      'type', 'scanning_timeout',
      'title', 'Scanning Paused',
      'body', format(
        'No trades found in 15 minutes. Continue scanning?'
      ),
      'priority', 'high',
      'data', jsonb_build_object(
        'modal_id', v_modal_id,
        'session_id', p_session_id,
        'action', 'open_continuation_modal'
      )
    )::text
  );

  RAISE NOTICE 'Continuation modal created: modal_id=%, notification_id=%', v_modal_id, v_notification_id;
END;
$$;

COMMENT ON FUNCTION trigger_continuation_modal IS
  'Sets session to awaiting_continuation status, creates persistent modal, and dispatches push notification';

-- ============================================================================
-- Fix create_session_ended_modal function
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
  -- Get session details (FIXED: goal_amount -> target_value)
  SELECT
    gs.user_id,
    gs.target_value,
    gs.current_pnl,
    gs.scanning_started_at,
    gs.start_time,
    gs.created_at,
    gs.status,
    gs.end_time
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Get trade count
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_trades
  WHERE goal_session_id = p_session_id;

  -- Calculate session duration in minutes
  v_duration_minutes := EXTRACT(EPOCH FROM (
    COALESCE(v_session.end_time, now()) -
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
  'Creates a persistent modal to inform users their session ended while they were away. Prevents duplicates.';

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO service_role;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal TO service_role;