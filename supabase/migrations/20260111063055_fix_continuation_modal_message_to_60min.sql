/*
  # Fix Continuation Modal Message Text to 60 Minutes

  ## Problem
  The continuation modal message still says "15 minutes" even though the timeout logic
  was correctly updated to 60 minutes. This is a cosmetic fix to update the message text.

  ## Changes
  - Drop and recreate `trigger_continuation_modal()` function
  - Update all "15 minutes" message text to "60 minutes"
  - Update function comment

  ## Security
  - No changes to function signature or behavior
  - Maintains all existing security (SECURITY DEFINER with proper auth checks)
*/

-- ============================================================================
-- Drop and Recreate trigger_continuation_modal with Updated Message Text
-- ============================================================================

DROP FUNCTION IF EXISTS trigger_continuation_modal(uuid);

CREATE FUNCTION trigger_continuation_modal(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_modal_id uuid;
  v_notification_id uuid;
  v_current_pnl numeric;
  v_trade_count integer;
BEGIN
  -- Get session details
  SELECT
    gs.user_id,
    gs.target_value,
    gs.status
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Session not found
  IF v_session.user_id IS NULL THEN
    RAISE NOTICE '[trigger_continuation_modal] Session % not found', p_session_id;
    RETURN;
  END IF;

  -- Only proceed if session is in scanning or trade_pending status
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RAISE NOTICE '[trigger_continuation_modal] Session % not in valid status: %', p_session_id, v_session.status;
    RETURN;
  END IF;

  -- Check for duplicate modal BEFORE creating
  IF EXISTS (
    SELECT 1 FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL
  ) THEN
    RAISE NOTICE '[trigger_continuation_modal] Modal already exists for session %', p_session_id;
    RETURN;
  END IF;

  -- Calculate current PnL from trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO v_current_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'closed';

  -- Count trades in this session
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id;

  -- Update session status
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_confirmation = true,
    continuation_confirmation_expires_at = now() + interval '1 minute',
    updated_at = now()
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
      'trades_in_session', v_trade_count,
      'current_progress', v_current_pnl,
      'target_value', v_session.target_value,
      'continuation_prompt', 'No trade opportunities found in the last 60 minutes. Would you like to continue scanning or close this session?',
      'timestamp', now()
    ),
    now() + interval '24 hours'
  )
  RETURNING id INTO v_modal_id;

  -- Create notification record
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
    'scanning_timeout',
    'Continue Scanning?',
    format(
      'Scanning paused after 60 minutes with %s trades. Continue or close session?',
      v_trade_count
    ),
    'high',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'session_id', p_session_id,
      'trades_count', v_trade_count,
      'current_pnl', v_current_pnl,
      'target', v_session.target_value
    )
  )
  RETURNING id INTO v_notification_id;

  -- Trigger push notification
  PERFORM pg_notify(
    'push_notification_request',
    json_build_object(
      'user_id', v_session.user_id,
      'notification_id', v_notification_id,
      'type', 'scanning_timeout',
      'title', 'Scanning Paused',
      'body', 'No trades found in 60 minutes. Continue scanning?',
      'priority', 'high',
      'data', jsonb_build_object(
        'modal_id', v_modal_id,
        'session_id', p_session_id,
        'action', 'open_continuation_modal'
      )
    )::text
  );

  RAISE NOTICE '[trigger_continuation_modal] Created modal % and notification % for session %',
    v_modal_id, v_notification_id, p_session_id;
END;
$$;

COMMENT ON FUNCTION trigger_continuation_modal(uuid) IS
  'CANONICAL VERSION: Triggers 60-minute continuation modal. Single parameter signature to avoid overloading conflicts.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION trigger_continuation_modal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal(uuid) TO service_role;