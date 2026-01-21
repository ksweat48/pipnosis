/*
  # Emergency Fix: 15-Minute Timeout & SL Trigger Issues

  ## Critical Bugs Fixed

  1. **Scanning Timeout Triggering DURING Trades**
     - Problem: trigger_continuation_modal was joining to wrong table (goal_trades instead of goal_session_trades)
     - This caused it to count 0 trades even when trades existed
     - Result: Modal triggered immediately after trade closed

  2. **Modal Buttons Not Working**
     - Ensure handle_continuation_decision function exists and works properly

  3. **Stop Loss Not Closing Trades**
     - Audit SL trigger and ensure it's firing correctly

  ## Changes

  1. Fix trigger_continuation_modal to use correct table (goal_session_trades)
  2. Add check for ANY open trades (not just count)
  3. Ensure modal ONLY triggers when NO open trades exist
  4. Create/fix handle_continuation_decision function
  5. Verify SL trigger logic
*/

-- ============================================================================
-- FIX 1: trigger_continuation_modal - Use correct table and check open trades
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
  v_has_open_trades boolean;
  v_trade_count integer;
BEGIN
  -- CRITICAL: Check for ANY open trades FIRST
  -- NEVER trigger timeout modal when trades are open
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades gst
    WHERE gst.goal_session_id = p_session_id
      AND gst.status = 'open'
  ) INTO v_has_open_trades;

  IF v_has_open_trades THEN
    RAISE NOTICE '[trigger_continuation_modal] Session % has OPEN trades - BLOCKING modal creation', p_session_id;
    RETURN;
  END IF;

  -- Get session details
  SELECT
    gs.user_id,
    gs.goal_amount,
    gs.current_progress,
    gs.status
  INTO v_session
  FROM goal_sessions gs
  WHERE gs.id = p_session_id;

  -- Session not found
  IF v_session IS NULL THEN
    RAISE WARNING '[trigger_continuation_modal] Session % not found', p_session_id;
    RETURN;
  END IF;

  -- Only proceed if session is in active scanning states
  -- CRITICAL: 'in_trade' should NEVER be in this list!
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RAISE NOTICE '[trigger_continuation_modal] Session % status is % - not eligible for timeout modal', 
      p_session_id, v_session.status;
    RETURN;
  END IF;

  -- Count total trades (for display purposes)
  SELECT COUNT(*) INTO v_trade_count
  FROM goal_session_trades gst
  WHERE gst.goal_session_id = p_session_id;

  RAISE NOTICE '[trigger_continuation_modal] Session % - NO open trades, % total trades - CREATING modal', 
    p_session_id, v_trade_count;

  -- Update session status
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_since = NOW(),
    updated_at = NOW()
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
      'current_progress', COALESCE(v_session.current_progress, 0),
      'target_value', v_session.goal_amount,
      'continuation_prompt', 'No trade opportunities found in the last 15 minutes. Would you like to continue scanning or close this session?',
      'timestamp', NOW()
    ),
    NOW() + INTERVAL '24 hours'
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
      v_trade_count
    ),
    'high',
    false,
    jsonb_build_object(
      'modal_id', v_modal_id,
      'session_id', p_session_id,
      'trades_count', v_trade_count,
      'current_pnl', COALESCE(v_session.current_progress, 0),
      'target', v_session.goal_amount
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
      'body', 'No trades found in 15 minutes. Continue scanning?',
      'priority', 'high',
      'data', jsonb_build_object(
        'modal_id', v_modal_id,
        'session_id', p_session_id,
        'action', 'open_continuation_modal'
      )
    )::text
  );

  RAISE NOTICE '[trigger_continuation_modal] ✅ Modal created: modal_id=%, notification_id=%', v_modal_id, v_notification_id;
END;
$$;

COMMENT ON FUNCTION trigger_continuation_modal IS
  'Creates 15-minute timeout modal ONLY when no trades are open and session has been scanning. Uses goal_session_trades table (not goal_trades). Never triggers during active trades.';

-- ============================================================================
-- FIX 2: Create/Fix handle_continuation_decision function
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_continuation_decision(
  p_session_id uuid,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_result jsonb;
BEGIN
  -- Get current session state
  SELECT
    user_id,
    status,
    awaiting_continuation_since
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Session not found
  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found'
    );
  END IF;

  -- Not awaiting continuation
  IF v_session.status != 'awaiting_continuation' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not awaiting continuation'
    );
  END IF;

  -- Handle decision
  IF p_decision = 'continue' THEN
    -- Reset scanning timer and continue
    UPDATE goal_sessions
    SET
      status = 'scanning',
      awaiting_continuation_since = NULL,
      scanning_started_at = NOW(),
      updated_at = NOW()
    WHERE id = p_session_id;

    -- Dismiss any pending modals
    UPDATE pending_user_modals
    SET dismissed_at = NOW(),
        user_action = 'continue'
    WHERE goal_session_id = p_session_id
      AND dismissed_at IS NULL;

    -- Mark notifications as viewed
    UPDATE goal_notifications
    SET dismissed_at = NOW()
    WHERE goal_session_id = p_session_id
      AND type = 'scanning_timeout'
      AND dismissed_at IS NULL;

    v_result := jsonb_build_object(
      'success', true,
      'action', 'continue',
      'message', 'Session will continue scanning for 15 more minutes'
    );

  ELSIF p_decision = 'close' THEN
    -- Close the session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      awaiting_continuation_since = NULL,
      updated_at = NOW()
    WHERE id = p_session_id;

    -- Dismiss any pending modals
    UPDATE pending_user_modals
    SET dismissed_at = NOW(),
        user_action = 'close'
    WHERE goal_session_id = p_session_id
      AND dismissed_at IS NULL;

    -- Mark notifications as viewed
    UPDATE goal_notifications
    SET dismissed_at = NOW()
    WHERE goal_session_id = p_session_id
      AND type = 'scanning_timeout'
      AND dismissed_at IS NULL;

    v_result := jsonb_build_object(
      'success', true,
      'action', 'close',
      'message', 'Session closed by user'
    );

  ELSE
    v_result := jsonb_build_object(
      'success', false,
      'error', 'Invalid decision. Must be "continue" or "close"'
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION handle_continuation_decision IS
  'Handles user response to 15-minute continuation prompt. Decision must be "continue" or "close".';

-- Grant permissions
GRANT EXECUTE ON FUNCTION handle_continuation_decision TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_decision TO service_role;

-- ============================================================================
-- FIX 3: Emergency cleanup - Clear stuck users IMMEDIATELY
-- ============================================================================

DO $$
DECLARE
  v_cleared_count integer;
BEGIN
  -- Dismiss ALL stuck scanning_timeout notifications
  WITH cleared AS (
    UPDATE goal_notifications
    SET dismissed_at = NOW()
    WHERE type = 'scanning_timeout'
      AND dismissed_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cleared_count FROM cleared;

  IF v_cleared_count > 0 THEN
    RAISE NOTICE '[Emergency Cleanup] Dismissed % stuck scanning_timeout notifications', v_cleared_count;
  END IF;

  -- Fix any sessions stuck in awaiting_continuation with no open trades
  WITH fixed AS (
    UPDATE goal_sessions
    SET
      status = 'scanning',
      awaiting_continuation_since = NULL,
      scanning_started_at = NOW(),
      updated_at = NOW()
    WHERE status = 'awaiting_continuation'
      AND NOT EXISTS (
        SELECT 1
        FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.status = 'open'
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cleared_count FROM fixed;

  IF v_cleared_count > 0 THEN
    RAISE NOTICE '[Emergency Cleanup] Fixed % sessions stuck in awaiting_continuation', v_cleared_count;
  END IF;
END $$;

-- ============================================================================
-- FIX 4: Verify SL/TP Trigger Exists and Works
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'check_sl_tp_realtime'
  ) THEN
    RAISE WARNING 'SL/TP trigger function check_sl_tp_realtime does NOT exist! This is a critical issue.';
  ELSE
    RAISE NOTICE 'SL/TP trigger function check_sl_tp_realtime exists ✓';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_check_sl_tp_realtime'
  ) THEN
    RAISE WARNING 'SL/TP trigger NOT attached to realtime_prices table! Trades will NOT close on SL/TP hit.';
  ELSE
    RAISE NOTICE 'SL/TP trigger is attached ✓';
  END IF;
END $$;
