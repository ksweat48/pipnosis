/*
  # Add Continuation Modal with Push Notifications

  1. Changes
    - Add 'continuation' to valid modal types
    - Modify trigger_continuation_modal to create persistent modal
    - Add push notification dispatch for 15-minute timeout
    - Add 'scanning_timeout' notification type

  2. Purpose
    - Ensure users receive push notification when 15 minutes elapse
    - Persist modal so users see it even if away from app
    - Allow clicking notification to return to app and respond

  3. Security
    - Function uses SECURITY DEFINER (runs as owner)
    - Creates modal for authenticated user
    - Sends push notification to all user's devices
*/

-- Add 'continuation' to valid modal types
ALTER TABLE pending_user_modals
  DROP CONSTRAINT IF EXISTS valid_modal_type;

ALTER TABLE pending_user_modals
  ADD CONSTRAINT valid_modal_type
  CHECK (modal_type IN ('trade_closed', 'goal_achieved', 'session_update', 'continuation'));

-- Add 'scanning_timeout' to valid notification types (if not exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goal_notifications'
    AND constraint_name = 'valid_notification_type'
  ) THEN
    ALTER TABLE goal_notifications
      DROP CONSTRAINT valid_notification_type;
  END IF;
END $$;

-- Recreate notification type constraint with all existing types plus scanning_timeout
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type
  CHECK (type IN (
    'signal', 'alert', 'completion', 'mid_trade_trigger',
    'goal_achieved', 'trade_closed', 'scanning_timeout',
    'wellness_check', 'session_update', 'progress'
  ));

COMMENT ON CONSTRAINT valid_notification_type ON goal_notifications IS
  'Valid notification types including scanning_timeout for 15-minute continuation prompts';

-- Enhanced trigger_continuation_modal function
-- Creates persistent modal AND sends push notification
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
  -- Get session details
  SELECT
    gs.user_id,
    gs.goal_amount,
    gs.current_pnl,
    gs.status,
    COUNT(gt.id) as trade_count
  INTO v_session
  FROM goal_sessions gs
  LEFT JOIN goal_trades gt ON gt.goal_session_id = gs.id
  WHERE gs.id = p_session_id
  GROUP BY gs.id, gs.user_id, gs.goal_amount, gs.current_pnl, gs.status;

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
      'target_value', v_session.goal_amount,
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
      'target', v_session.goal_amount
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal TO service_role;
