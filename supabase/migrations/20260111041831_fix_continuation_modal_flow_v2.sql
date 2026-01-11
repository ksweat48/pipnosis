/*
  # Fix Continuation Modal Flow

  ## Problem
  Entry intent timeout → modal created BUT session status immediately changes to 'scanning'
  → session bypasses modal and starts scanning again
  → user never sees the "Continue or Close?" modal

  ## Root Causes
  1. request_session_continuation() doesn't pause the session (no status change)
  2. Coordinator calls transitionState('ABANDONED_RESCAN_REQUESTED') which sets status='scanning'
  3. No auto-close mechanism running for continuation_deadline
  4. Two different continuation systems (old 60min + new entry timeout) not unified

  ## Fixes
  1. Update request_session_continuation to set status='awaiting_continuation' (pauses session)
  2. Set entry_monitor_state to pause scanning
  3. Add trigger to auto-close expired continuations every update
  4. Coordinator will NOT transition state - modal creation handles it

  ## Flow After Fix
  Entry intent times out
  → request_session_continuation() called
  → Sets status='awaiting_continuation' + entry_monitor_state='ABANDONED_RESCAN_REQUESTED'
  → Creates modal in pending_user_modals
  → User sees modal with 60s countdown
  → If no response: auto-close trigger fires on next update
  → If user responds: handle_continuation_decision() processes choice
*/

-- ============================================================================
-- STEP 1: Fix request_session_continuation to PAUSE the session
-- ============================================================================

CREATE OR REPLACE FUNCTION request_session_continuation(
  p_session_id uuid,
  p_reason text DEFAULT 'intent_timeout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deadline timestamptz;
  v_result jsonb;
BEGIN
  -- Calculate 60-second deadline
  v_deadline := now() + interval '60 seconds';

  -- Update session to PAUSED awaiting continuation state
  -- CRITICAL: Set status to 'awaiting_continuation' to STOP all scanning/monitoring
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_response = true,
    continuation_modal_shown_at = now(),
    continuation_deadline = v_deadline,
    continuation_decision = NULL,
    entry_monitor_state = 'ABANDONED_RESCAN_REQUESTED',
    updated_at = now()
  WHERE id = p_session_id
  RETURNING jsonb_build_object(
    'session_id', id,
    'awaiting_response', true,
    'status', status,
    'modal_shown_at', continuation_modal_shown_at,
    'deadline', continuation_deadline,
    'seconds_remaining', EXTRACT(EPOCH FROM (continuation_deadline - now()))
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  -- Create pending modal for user
  INSERT INTO pending_user_modals (user_id, goal_session_id, modal_type, modal_data, expires_at)
  SELECT
    user_id,
    id,
    'continuation',
    jsonb_build_object(
      'session_id', id,
      'reason', p_reason,
      'deadline', v_deadline,
      'message', 'Entry intent timed out. Would you like to continue scanning or close this session?',
      'countdown_seconds', 60
    ),
    v_deadline + interval '1 minute' -- Modal expires 1 min after deadline
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Create notification
  INSERT INTO goal_notifications (user_id, session_id, type, title, message, metadata)
  SELECT
    user_id,
    id,
    'continuation_required',
    'Decision Required',
    'Entry intent expired. Continue scanning or close session?',
    jsonb_build_object(
      'session_id', id,
      'reason', p_reason,
      'deadline', v_deadline
    )
  FROM goal_sessions
  WHERE id = p_session_id;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- STEP 2: Add trigger to auto-close expired continuations
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_auto_close_expired_continuation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if this session is awaiting continuation and deadline passed
  IF NEW.awaiting_continuation_response = true
     AND NEW.continuation_deadline IS NOT NULL
     AND now() > NEW.continuation_deadline
     AND NEW.status = 'awaiting_continuation'
  THEN
    RAISE NOTICE '[Auto-Close] Session % continuation deadline expired', NEW.id;

    -- Auto-close the session
    NEW.status := 'completed';
    NEW.completed_at := now();
    NEW.awaiting_continuation_response := false;
    NEW.continuation_decision := 'auto_closed';
    NEW.entry_monitor_state := NULL;

    -- Delete modal (will be done in separate transaction via pg_notify)
    PERFORM pg_notify('auto_close_continuation', json_build_object(
      'session_id', NEW.id,
      'user_id', NEW.user_id
    )::text);
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_auto_close_continuation ON goal_sessions;

-- Create trigger on UPDATE
CREATE TRIGGER trigger_auto_close_continuation
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_close_expired_continuation();

COMMENT ON TRIGGER trigger_auto_close_continuation ON goal_sessions IS
  'Auto-closes sessions when continuation_deadline expires with no response';

-- ============================================================================
-- STEP 3: Listener to clean up modals when auto-close happens
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_auto_closed_continuation_modal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If session was auto-closed due to continuation timeout, clean up modal
  IF NEW.continuation_decision = 'auto_closed'
     AND OLD.continuation_decision IS DISTINCT FROM NEW.continuation_decision
  THEN
    -- Delete continuation modal
    DELETE FROM pending_user_modals
    WHERE goal_session_id = NEW.id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL;

    -- Create notification
    INSERT INTO goal_notifications (user_id, session_id, type, title, message, metadata)
    VALUES (
      NEW.user_id,
      NEW.id,
      'session_auto_closed',
      'Session Auto-Closed',
      'Your session was automatically closed after no response within 60 seconds.',
      jsonb_build_object(
        'session_id', NEW.id,
        'reason', 'continuation_timeout',
        'deadline', NEW.continuation_deadline
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_cleanup_auto_closed_modal ON goal_sessions;

-- Create trigger AFTER UPDATE
CREATE TRIGGER trigger_cleanup_auto_closed_modal
  AFTER UPDATE ON goal_sessions
  FOR EACH ROW
  WHEN (NEW.continuation_decision = 'auto_closed')
  EXECUTE FUNCTION cleanup_auto_closed_continuation_modal();

-- ============================================================================
-- STEP 4: Add missing notification types (include ALL existing types)
-- ============================================================================

DO $$
BEGIN
  -- Drop existing constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goal_notifications'
    AND constraint_name = 'valid_notification_type'
  ) THEN
    ALTER TABLE goal_notifications DROP CONSTRAINT valid_notification_type;
  END IF;
END $$;

-- Recreate with ALL types (existing + new)
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type
  CHECK (type IN (
    'signal', 'alert', 'completion', 'mid_trade_trigger',
    'goal_achieved', 'trade_closed', 'scanning_timeout',
    'wellness_check', 'session_update', 'progress',
    'session_ended', 'session_auto_closed', 'session_paused',
    'continuation_required', 'session_started', 'trade_entry',
    'entry_abandoned', 'entry_monitoring_started', 'entry_quality_improving',
    'entry_quality_ready', 'sl_triggered'
  ));

-- ============================================================================
-- STEP 5: Emergency fix - close any currently stuck sessions
-- ============================================================================

DO $$
DECLARE
  v_closed_count integer := 0;
BEGIN
  -- Find sessions awaiting continuation with expired deadlines
  UPDATE goal_sessions
  SET
    status = 'completed',
    completed_at = now(),
    awaiting_continuation_response = false,
    continuation_decision = 'auto_closed',
    entry_monitor_state = NULL,
    updated_at = now()
  WHERE awaiting_continuation_response = true
    AND continuation_deadline IS NOT NULL
    AND now() > continuation_deadline
    AND status != 'completed';

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;

  IF v_closed_count > 0 THEN
    RAISE NOTICE '[Emergency] Auto-closed % stuck continuation sessions', v_closed_count;
  END IF;
END $$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION request_session_continuation TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_decision TO authenticated;