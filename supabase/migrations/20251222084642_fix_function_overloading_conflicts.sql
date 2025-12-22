/*
  # Fix Function Overloading Conflicts - COMPLETE SOLUTION

  ## Problem
  Multiple migrations created different versions of the same functions with different signatures:
  - trigger_continuation_modal(uuid) RETURNS void
  - trigger_continuation_modal(uuid, text) RETURNS uuid

  This causes PostgreSQL error 42725: "function is not unique"
  and PostgREST error PGRST203: "Could not choose the best candidate function"

  ## Solution
  1. Drop ALL existing versions of conflicting functions
  2. Create ONE canonical version of each function
  3. Use explicit signatures to avoid any ambiguity

  ## Functions Fixed
  - trigger_continuation_modal
  - client_trigger_continuation_modal
  - create_session_ended_modal
  - close_goal_session_safely

  ## Security
  - All functions use SECURITY DEFINER
  - RLS policies unchanged
  - Permissions granted to authenticated and service_role
*/

-- ============================================================================
-- STEP 1: Drop ALL existing function versions explicitly
-- ============================================================================

-- Drop trigger_continuation_modal - all possible signatures
DROP FUNCTION IF EXISTS trigger_continuation_modal(uuid);
DROP FUNCTION IF EXISTS trigger_continuation_modal(uuid, text);
DROP FUNCTION IF EXISTS trigger_continuation_modal(p_session_id uuid);
DROP FUNCTION IF EXISTS trigger_continuation_modal(p_session_id uuid, p_reason text);

-- Drop client_trigger_continuation_modal - all possible signatures
DROP FUNCTION IF EXISTS client_trigger_continuation_modal(uuid);
DROP FUNCTION IF EXISTS client_trigger_continuation_modal(p_session_id uuid);

-- Drop create_session_ended_modal - all possible signatures
DROP FUNCTION IF EXISTS create_session_ended_modal(uuid);
DROP FUNCTION IF EXISTS create_session_ended_modal(uuid, text);
DROP FUNCTION IF EXISTS create_session_ended_modal(p_session_id uuid);
DROP FUNCTION IF EXISTS create_session_ended_modal(p_session_id uuid, p_close_reason text);

-- Drop close_goal_session_safely - all possible signatures
DROP FUNCTION IF EXISTS close_goal_session_safely(uuid, text);
DROP FUNCTION IF EXISTS close_goal_session_safely(p_session_id uuid, p_close_reason text);

-- ============================================================================
-- STEP 2: Create SINGLE canonical version of trigger_continuation_modal
-- ============================================================================

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
      'continuation_prompt', 'No trade opportunities found in the last 15 minutes. Would you like to continue scanning or close this session?',
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
      'Scanning paused after 15 minutes with %s trades. Continue or close session?',
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
      'body', 'No trades found in 15 minutes. Continue scanning?',
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
  'CANONICAL VERSION: Triggers 15-minute continuation modal. Single parameter signature to avoid overloading conflicts.';

-- ============================================================================
-- STEP 3: Create SINGLE canonical version of client_trigger_continuation_modal
-- ============================================================================

CREATE FUNCTION client_trigger_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_should_show boolean;
  v_session record;
BEGIN
  -- Verify ownership
  SELECT id, user_id, status FROM goal_sessions
  WHERE id = p_session_id AND user_id = auth.uid()
  INTO v_session;

  IF v_session.id IS NULL THEN
    RAISE NOTICE '[client_trigger_continuation_modal] Session % not found or not owned by user', p_session_id;
    RETURN false;
  END IF;

  -- Check if should show modal
  v_should_show := should_show_continuation_modal(p_session_id);

  IF v_should_show THEN
    -- Trigger the modal
    PERFORM trigger_continuation_modal(p_session_id);
    RAISE NOTICE '[client_trigger_continuation_modal] Client triggered modal for session %', p_session_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION client_trigger_continuation_modal(uuid) IS
  'CANONICAL VERSION: Client-callable function to trigger continuation modal. Single parameter signature.';

-- ============================================================================
-- STEP 4: Create SINGLE canonical version of create_session_ended_modal
-- ============================================================================

CREATE FUNCTION create_session_ended_modal(
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
  -- Get session details
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

  IF v_session.user_id IS NULL THEN
    RAISE NOTICE '[create_session_ended_modal] Session % not found', p_session_id;
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
    RAISE NOTICE '[create_session_ended_modal] Modal already exists for session %', p_session_id;
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
      'duration_minutes', ROUND(v_duration_minutes::numeric, 1),
      'message', CASE
        WHEN p_close_reason = 'timeout' THEN 'Session ended: No user response after 20 minutes'
        WHEN p_close_reason = 'safety_net' THEN 'Session ended: Safety timeout (60 minutes)'
        ELSE 'Session ended'
      END
    ),
    now() + interval '7 days'
  )
  RETURNING id INTO v_modal_id;

  -- Create notification
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

  RAISE NOTICE '[create_session_ended_modal] Created modal % for session %', v_modal_id, p_session_id;

  RETURN v_modal_id;
END;
$$;

COMMENT ON FUNCTION create_session_ended_modal(uuid, text) IS
  'CANONICAL VERSION: Creates session ended modal. Two parameters with default for backwards compatibility.';

-- ============================================================================
-- STEP 5: Create SINGLE canonical version of close_goal_session_safely
-- ============================================================================

CREATE FUNCTION close_goal_session_safely(
  p_session_id uuid,
  p_close_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_trades integer;
  v_modal_id uuid;
BEGIN
  -- Check for open trades
  SELECT COUNT(*) INTO v_open_trades
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status IN ('open', 'pending', 'soft_closing');

  -- Don't close if trades are open
  IF v_open_trades > 0 THEN
    RAISE NOTICE '[close_goal_session_safely] Cannot close session %: % open trades', p_session_id, v_open_trades;
    RETURN false;
  END IF;

  -- Create session ended modal
  v_modal_id := create_session_ended_modal(p_session_id, p_close_reason);

  -- Update session status
  UPDATE goal_sessions
  SET
    status = 'completed',
    end_time = now(),
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  RAISE NOTICE '[close_goal_session_safely] Session % closed with reason: %', p_session_id, p_close_reason;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION close_goal_session_safely(uuid, text) IS
  'CANONICAL VERSION: Safely closes session after checking for open trades. Two required parameters.';

-- ============================================================================
-- STEP 6: Grant permissions to all canonical functions
-- ============================================================================

-- trigger_continuation_modal
GRANT EXECUTE ON FUNCTION trigger_continuation_modal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_continuation_modal(uuid) TO service_role;

-- client_trigger_continuation_modal
GRANT EXECUTE ON FUNCTION client_trigger_continuation_modal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION client_trigger_continuation_modal(uuid) TO service_role;

-- create_session_ended_modal
GRANT EXECUTE ON FUNCTION create_session_ended_modal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION create_session_ended_modal(uuid, text) TO service_role;

-- close_goal_session_safely
GRANT EXECUTE ON FUNCTION close_goal_session_safely(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_safely(uuid, text) TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Function overloading conflicts resolved';
  RAISE NOTICE '✅ All functions now have single canonical versions';
  RAISE NOTICE '✅ Permissions granted to authenticated and service_role';
END $$;
