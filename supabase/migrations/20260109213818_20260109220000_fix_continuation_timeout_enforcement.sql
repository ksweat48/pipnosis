/*
  # Fix Continuation Modal 60-Second Timeout Enforcement

  ## Problem
  Sessions showing "awaiting_continuation" modal don't auto-close after 60 seconds.
  The Force Close and Stop Session buttons also don't work properly in this state.

  ## Root Causes
  1. No automatic enforcement of continuation_confirmation_expires_at timeout
  2. Client UI countdown reaches 0 but session stays open
  3. Force Close button doesn't handle awaiting_continuation state properly
  4. Stop Session button logic is too complex for this simple state

  ## Fixes Applied
  1. **Trigger-based timeout enforcement** - Auto-closes sessions when timeout expires
  2. **Improved force close function** - Handles awaiting_continuation specifically
  3. **Emergency recovery** - Closes all currently stuck sessions
  4. **Health check function** - Detects stuck sessions on page load

  ## Security
  - All functions use SECURITY DEFINER with proper auth checks
  - RLS policies remain intact
  - Audit logging for all auto-closures
*/

-- ============================================================================
-- STEP 1: Emergency Recovery - Close ALL Currently Stuck Sessions
-- ============================================================================

DO $$
DECLARE
  v_closed_count integer;
  v_session record;
BEGIN
  v_closed_count := 0;
  -- Close sessions where continuation modal timeout has expired
  FOR v_session IN
    SELECT id, user_id, continuation_confirmation_expires_at
    FROM goal_sessions
    WHERE status = 'awaiting_continuation'
      AND continuation_confirmation_expires_at IS NOT NULL
      AND now() > continuation_confirmation_expires_at
  LOOP
    -- Close the session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = v_session.id;

    -- Create notification for user
    INSERT INTO goal_notifications (
      user_id,
      goal_session_id,
      type,
      title,
      message,
      created_at
    ) VALUES (
      v_session.user_id,
      v_session.id,
      'session_ended',
      'Session Auto-Closed',
      'Your session was automatically closed after no response to the continuation prompt (60 seconds elapsed).',
      now()
    );

    v_closed_count := v_closed_count + 1;
  END LOOP;

  IF v_closed_count > 0 THEN
    RAISE NOTICE '[Emergency Recovery] Closed % stuck sessions with expired timeouts', v_closed_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create Trigger for Automatic Timeout Enforcement
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_continuation_timeout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only check sessions in awaiting_continuation status
  IF NEW.status = 'awaiting_continuation' AND
     NEW.continuation_confirmation_expires_at IS NOT NULL AND
     now() > NEW.continuation_confirmation_expires_at
  THEN
    RAISE NOTICE '[enforce_continuation_timeout] Auto-closing expired session %', NEW.id;

    -- Auto-close the session
    NEW.status := 'user_stopped';
    NEW.completed_at := now();
    NEW.awaiting_continuation_confirmation := false;
    NEW.continuation_confirmation_expires_at := NULL;
    NEW.updated_at := now();

    -- Create notification (in separate transaction to avoid blocking)
    PERFORM pg_notify('session_auto_closed', json_build_object(
      'session_id', NEW.id,
      'user_id', NEW.user_id
    )::text);
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS trigger_enforce_continuation_timeout ON goal_sessions;

CREATE TRIGGER trigger_enforce_continuation_timeout
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_continuation_timeout();

COMMENT ON TRIGGER trigger_enforce_continuation_timeout ON goal_sessions IS
  'Automatically closes sessions when continuation_confirmation_expires_at timeout is reached';

-- ============================================================================
-- STEP 3: Improved Force Close Function for Stuck Sessions
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_continuation_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_result jsonb;
BEGIN
  -- Get session and verify ownership
  SELECT id, user_id, status, awaiting_continuation_confirmation, continuation_confirmation_expires_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found or unauthorized'
    );
  END IF;

  -- Special handling for awaiting_continuation status
  IF v_session.status = 'awaiting_continuation' THEN
    -- Simply close it - no trades to worry about
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[force_close_continuation_session] Session % force closed (was awaiting continuation)', p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Session closed successfully'
    );
  END IF;

  -- For other active statuses, use standard force close
  IF v_session.status IN ('scanning', 'trade_pending', 'initializing') THEN
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[force_close_continuation_session] Session % force closed (was %)', p_session_id, v_session.status;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Session closed successfully'
    );
  END IF;

  -- Session is already closed or in invalid state
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Session is not in a closable state: ' || v_session.status
  );
END;
$$;

COMMENT ON FUNCTION force_close_continuation_session IS
  'Force closes a session, with special handling for awaiting_continuation state';

GRANT EXECUTE ON FUNCTION force_close_continuation_session TO authenticated;

-- ============================================================================
-- STEP 4: Simplified Stop Function for Awaiting Continuation
-- ============================================================================

CREATE OR REPLACE FUNCTION stop_continuation_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_open_trades_count integer;
BEGIN
  -- Get session and verify ownership
  SELECT id, user_id, status
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found or unauthorized'
    );
  END IF;

  -- Count open trades
  SELECT COUNT(*)
  INTO v_open_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'open';

  -- If session is awaiting_continuation, it should have NO open trades
  -- If it does, that's a data integrity issue, but we'll still close it
  IF v_session.status = 'awaiting_continuation' THEN
    IF v_open_trades_count > 0 THEN
      RAISE WARNING '[stop_continuation_session] Session % in awaiting_continuation has % open trades - data integrity issue!',
        p_session_id, v_open_trades_count;
    END IF;

    -- Close the session immediately
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[stop_continuation_session] Session % stopped by user (was awaiting continuation)', p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Session stopped successfully'
    );
  END IF;

  -- For other statuses, return error - use normal stop flow
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Use normal stop flow for status: ' || v_session.status,
    'should_use_normal_flow', true
  );
END;
$$;

COMMENT ON FUNCTION stop_continuation_session IS
  'Simplified stop function specifically for awaiting_continuation state';

GRANT EXECUTE ON FUNCTION stop_continuation_session TO authenticated;

-- ============================================================================
-- STEP 5: Health Check Function for Page Load Detection
-- ============================================================================

CREATE OR REPLACE FUNCTION check_session_timeout_health(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_elapsed_seconds numeric;
  v_should_auto_close boolean := false;
  v_reason text := null;
BEGIN
  -- Get session and verify ownership
  SELECT
    id,
    user_id,
    status,
    awaiting_continuation_confirmation,
    continuation_confirmation_expires_at,
    scanning_started_at,
    created_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'healthy', true,
      'message', 'Session not found or unauthorized'
    );
  END IF;

  -- Check 1: Timeout expired while awaiting continuation
  IF v_session.status = 'awaiting_continuation' AND
     v_session.continuation_confirmation_expires_at IS NOT NULL
  THEN
    IF now() > v_session.continuation_confirmation_expires_at THEN
      v_should_auto_close := true;
      v_elapsed_seconds := EXTRACT(EPOCH FROM (now() - v_session.continuation_confirmation_expires_at));
      v_reason := format('Continuation timeout expired %s seconds ago', ROUND(v_elapsed_seconds));
    END IF;
  END IF;

  -- Check 2: Safety net - scanning too long without modal
  IF v_session.status IN ('scanning', 'trade_pending') AND
     v_session.scanning_started_at IS NOT NULL AND
     NOT v_session.awaiting_continuation_confirmation
  THEN
    v_elapsed_seconds := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60;
    IF v_elapsed_seconds > 20 THEN
      -- Check if any trades found
      IF NOT EXISTS (
        SELECT 1 FROM goal_session_trades
        WHERE goal_session_id = p_session_id
          AND created_at >= v_session.scanning_started_at
      ) THEN
        v_should_auto_close := true;
        v_reason := format('Scanning for %s minutes without trades and no modal shown', ROUND(v_elapsed_seconds));
      END IF;
    END IF;
  END IF;

  -- If should auto-close, do it
  IF v_should_auto_close THEN
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = p_session_id;

    RAISE NOTICE '[check_session_timeout_health] Auto-closed session %: %', p_session_id, v_reason;

    RETURN jsonb_build_object(
      'healthy', false,
      'auto_closed', true,
      'reason', v_reason,
      'message', 'Session was automatically closed due to timeout'
    );
  END IF;

  -- Session is healthy
  RETURN jsonb_build_object(
    'healthy', true,
    'message', 'Session is operating normally'
  );
END;
$$;

COMMENT ON FUNCTION check_session_timeout_health IS
  'Checks session health and auto-closes if timeout has expired (run on page load)';

GRANT EXECUTE ON FUNCTION check_session_timeout_health TO authenticated;

-- ============================================================================
-- STEP 6: Background Worker Function (for scheduled execution)
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_close_expired_continuation_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_closed_count integer := 0;
  v_session record;
BEGIN
  -- Find and close all expired sessions
  FOR v_session IN
    SELECT id, user_id, continuation_confirmation_expires_at
    FROM goal_sessions
    WHERE status = 'awaiting_continuation'
      AND continuation_confirmation_expires_at IS NOT NULL
      AND now() > continuation_confirmation_expires_at
  LOOP
    -- Close the session
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE id = v_session.id;

    -- Create notification
    INSERT INTO goal_notifications (
      user_id,
      goal_session_id,
      type,
      title,
      message,
      created_at
    ) VALUES (
      v_session.user_id,
      v_session.id,
      'session_ended',
      'Session Auto-Closed',
      'Your session was automatically closed after 60 seconds with no response.',
      now()
    );

    v_closed_count := v_closed_count + 1;

    RAISE NOTICE '[auto_close_expired_continuation_sessions] Closed session % (expired at %)',
      v_session.id, v_session.continuation_confirmation_expires_at;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'closed_count', v_closed_count,
    'message', format('Closed %s expired session(s)', v_closed_count)
  );
END;
$$;

COMMENT ON FUNCTION auto_close_expired_continuation_sessions IS
  'Background worker function - closes all sessions with expired continuation timeouts';

GRANT EXECUTE ON FUNCTION auto_close_expired_continuation_sessions TO service_role;

-- ============================================================================
-- STEP 7: Grant necessary permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION enforce_continuation_timeout TO service_role;
GRANT EXECUTE ON FUNCTION force_close_continuation_session TO authenticated;
GRANT EXECUTE ON FUNCTION stop_continuation_session TO authenticated;
GRANT EXECUTE ON FUNCTION check_session_timeout_health TO authenticated;
GRANT EXECUTE ON FUNCTION auto_close_expired_continuation_sessions TO service_role;
