/*
  # Fix goal_notifications title NULL constraint error

  1. Problem
    - The `create_session_ended_modal` function inserts into goal_notifications
    - It's missing the required `title` column (NOT NULL constraint)
    - This causes 400 errors when trying to force close sessions

  2. Solution
    - Update the function to include a proper `title` value
    - Also fix other functions that may have the same issue:
      - `trigger_continuation_modal`
      - `auto_send_push_notification_on_modal`

  3. Security
    - No RLS changes needed
*/

-- Fix create_session_ended_modal to include title
CREATE OR REPLACE FUNCTION create_session_ended_modal(
  p_session_id uuid,
  p_close_reason text DEFAULT 'user_stopped'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_trade_count integer;
  v_duration_minutes numeric;
  v_modal_id uuid;
  v_final_pnl numeric;
  v_title text;
BEGIN
  -- Get session details with correct columns
  SELECT 
    gs.user_id,
    gs.target_value,
    gs.scanning_started_at,
    gs.start_time,
    gs.created_at,
    gs.status,
    gs.end_time
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  -- Count trades AFTER scanning started
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
  AND opened_at >= COALESCE(v_session.scanning_started_at, v_session.start_time);

  -- Calculate PnL from actual trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO v_final_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
  AND status = 'closed';

  -- Calculate session duration
  v_duration_minutes := EXTRACT(EPOCH FROM (
    COALESCE(v_session.end_time, now()) - 
    COALESCE(v_session.scanning_started_at, v_session.start_time, v_session.created_at)
  )) / 60;

  -- Generate title based on close reason
  v_title := CASE 
    WHEN p_close_reason = 'timeout' THEN 'Session Timed Out'
    WHEN p_close_reason = 'safety_net' THEN 'Session Safety Timeout'
    WHEN p_close_reason = 'goal_achieved' THEN 'Goal Achieved!'
    WHEN p_close_reason = 'user_stopped' THEN 'Session Ended'
    ELSE 'Session Complete'
  END;

  -- Check for duplicate modal
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
    AND modal_type = 'session_ended'
    AND dismissed_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- Create modal
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
      'trade_count', v_trade_count,
      'final_pnl', v_final_pnl,
      'target_value', v_session.target_value,
      'duration_minutes', v_duration_minutes,
      'message', CASE 
        WHEN p_close_reason = 'timeout' THEN 'Session ended: No user response after 20 minutes'
        WHEN p_close_reason = 'safety_net' THEN 'Session ended: Safety timeout (60 minutes)'
        ELSE 'Session ended'
      END
    ),
    now() + interval '7 days'
  )
  RETURNING id INTO v_modal_id;

  -- Create notification WITH TITLE (fixes NOT NULL constraint error)
  INSERT INTO goal_notifications (
    user_id,
    goal_session_id,
    type,
    title,
    message,
    priority,
    viewed,
    metadata
  ) VALUES (
    v_session.user_id,
    p_session_id,
    'session_ended',
    v_title,
    format('Session ended: %s trades, $%s P/L', v_trade_count, ROUND(v_final_pnl, 2)),
    'high',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'close_reason', p_close_reason,
      'trade_count', v_trade_count,
      'final_pnl', v_final_pnl
    )
  );

  RETURN v_modal_id;
END;
$$;

-- Also check and fix trigger_continuation_modal function
CREATE OR REPLACE FUNCTION trigger_continuation_modal(
  p_session_id uuid,
  p_reason text DEFAULT 'no_trades_timeout'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_user_id uuid;
  v_title text;
  v_message text;
BEGIN
  -- Get session info
  SELECT 
    gs.user_id,
    gs.target_value,
    gs.scanning_started_at,
    gs.status
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  IF v_session IS NULL THEN
    RAISE NOTICE '[trigger_continuation_modal] Session % not found', p_session_id;
    RETURN NULL;
  END IF;

  v_user_id := v_session.user_id;

  -- Set title and message based on reason
  IF p_reason = 'no_trades_timeout' THEN
    v_title := 'Continue Scanning?';
    v_message := 'No trades have been placed yet. Would you like to continue scanning for opportunities?';
  ELSIF p_reason = 'session_timeout' THEN
    v_title := 'Session Check-In';
    v_message := 'Your session has been running for a while. Would you like to continue?';
  ELSE
    v_title := 'Continue Session?';
    v_message := 'Would you like to continue your trading session?';
  END IF;

  -- Check for existing pending modal
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NULL
  ) THEN
    RAISE NOTICE '[trigger_continuation_modal] Modal already exists for session %', p_session_id;
    RETURN NULL;
  END IF;

  -- Update session status
  UPDATE goal_sessions
  SET 
    status = 'awaiting_continuation',
    awaiting_continuation_confirmation = true,
    continuation_confirmation_expires_at = now() + interval '20 minutes',
    updated_at = now()
  WHERE id = p_session_id;

  -- Create the modal
  INSERT INTO pending_user_modals (
    user_id,
    goal_session_id,
    modal_type,
    modal_data,
    priority,
    expires_at
  ) VALUES (
    v_user_id,
    p_session_id,
    'continuation',
    jsonb_build_object(
      'session_id', p_session_id,
      'reason', p_reason,
      'title', v_title,
      'message', v_message,
      'target_value', v_session.target_value,
      'scanning_started_at', v_session.scanning_started_at
    ),
    'critical',
    now() + interval '20 minutes'
  )
  RETURNING id INTO v_modal_id;

  -- Create notification WITH TITLE (fixes NOT NULL constraint error)
  INSERT INTO goal_notifications (
    user_id,
    goal_session_id,
    type,
    title,
    message,
    priority,
    viewed,
    metadata
  ) VALUES (
    v_user_id,
    p_session_id,
    'continuation_required',
    v_title,
    v_message,
    'critical',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'reason', p_reason,
      'expires_at', (now() + interval '20 minutes')
    )
  );

  RAISE NOTICE '[trigger_continuation_modal] Created modal % for session %', v_modal_id, p_session_id;

  RETURN v_modal_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_session_ended_modal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal(uuid, text) TO authenticated;
