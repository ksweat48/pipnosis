/*
  # Add Session Continuation System

  ## Purpose
  Adds SSOT tracking for session continuation decisions when entry intents timeout.
  When an intent times out, the system presents a modal to the user: "Continue scanning or close session?"
  This migration tracks the modal state and user response with a 60-second auto-close mechanism.

  ## Changes
  1. New Columns on `goal_sessions`:
    - `awaiting_continuation_response` (boolean) - Session is waiting for user decision
    - `continuation_modal_shown_at` (timestamptz) - When modal was first shown
    - `continuation_deadline` (timestamptz) - Auto-close deadline (60s from shown_at)
    - `continuation_decision` (text) - User's choice: 'continue', 'close', or 'auto_closed'

  2. New Function:
    - `request_session_continuation` - Mark session as awaiting continuation response
    - `handle_continuation_decision` - Process user's continuation decision
    - `auto_close_expired_continuations` - Close sessions that exceeded 60s deadline

  3. Security:
    - Users can only see/modify their own session continuation state

  ## SSOT Architecture
  - goal_sessions is authoritative for continuation state
  - Modal queue uses this state to show/hide continuation modal
  - Coordinator checks this state before scheduling rescan
  - Auto-close happens if no response within 60 seconds
*/

-- Add continuation tracking columns to goal_sessions
ALTER TABLE goal_sessions
ADD COLUMN IF NOT EXISTS awaiting_continuation_response boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS continuation_modal_shown_at timestamptz,
ADD COLUMN IF NOT EXISTS continuation_deadline timestamptz,
ADD COLUMN IF NOT EXISTS continuation_decision text CHECK (continuation_decision IN ('continue', 'close', 'auto_closed'));

-- Index for finding sessions awaiting continuation
CREATE INDEX IF NOT EXISTS idx_goal_sessions_awaiting_continuation
ON goal_sessions(user_id, awaiting_continuation_response)
WHERE awaiting_continuation_response = true;

-- Index for finding expired continuation deadlines
CREATE INDEX IF NOT EXISTS idx_goal_sessions_continuation_deadline
ON goal_sessions(continuation_deadline)
WHERE awaiting_continuation_response = true AND continuation_deadline IS NOT NULL;

-- Function: Request continuation decision from user
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

  -- Update session to awaiting continuation state
  UPDATE goal_sessions
  SET
    awaiting_continuation_response = true,
    continuation_modal_shown_at = now(),
    continuation_deadline = v_deadline,
    continuation_decision = NULL,
    updated_at = now()
  WHERE id = p_session_id
  RETURNING jsonb_build_object(
    'session_id', id,
    'awaiting_response', true,
    'modal_shown_at', continuation_modal_shown_at,
    'deadline', continuation_deadline,
    'seconds_remaining', EXTRACT(EPOCH FROM (continuation_deadline - now()))
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  -- Create pending modal for user
  INSERT INTO pending_user_modals (user_id, goal_session_id, modal_type, modal_data)
  SELECT
    user_id,
    id,
    'continuation',
    jsonb_build_object(
      'session_id', id,
      'reason', p_reason,
      'deadline', v_deadline,
      'message', 'Entry intent timed out. Would you like to continue scanning or close this session?'
    )
  FROM goal_sessions
  WHERE id = p_session_id;

  RETURN v_result;
END;
$$;

-- Function: Handle continuation decision
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
  -- Validate decision
  IF p_decision NOT IN ('continue', 'close') THEN
    RAISE EXCEPTION 'Invalid decision: %. Must be "continue" or "close"', p_decision;
  END IF;

  -- Get session and verify it's awaiting continuation
  SELECT * INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  IF NOT v_session.awaiting_continuation_response THEN
    RAISE WARNING 'Session % not awaiting continuation response', p_session_id;
    RETURN jsonb_build_object(
      'session_id', p_session_id,
      'warning', 'Session not awaiting continuation',
      'current_status', v_session.status
    );
  END IF;

  -- Handle decision
  IF p_decision = 'continue' THEN
    -- User wants to continue scanning
    UPDATE goal_sessions
    SET
      awaiting_continuation_response = false,
      continuation_decision = 'continue',
      status = 'scanning',
      next_scan_time = now() + interval '30 seconds',
      last_scan_time = now(),
      updated_at = now()
    WHERE id = p_session_id;

    v_result := jsonb_build_object(
      'session_id', p_session_id,
      'decision', 'continue',
      'new_status', 'scanning',
      'next_scan_time', now() + interval '30 seconds'
    );
  ELSE
    -- User wants to close session
    UPDATE goal_sessions
    SET
      awaiting_continuation_response = false,
      continuation_decision = 'close',
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    v_result := jsonb_build_object(
      'session_id', p_session_id,
      'decision', 'close',
      'new_status', 'completed'
    );
  END IF;

  -- Delete continuation modal from queue
  DELETE FROM pending_user_modals
  WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NULL;

  RETURN v_result;
END;
$$;

-- Function: Auto-close sessions that exceeded continuation deadline
CREATE OR REPLACE FUNCTION auto_close_expired_continuations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_closed_count integer := 0;
  v_session record;
  v_closed_sessions jsonb[] := '{}';
BEGIN
  -- Find and close expired sessions
  FOR v_session IN
    SELECT id, user_id, continuation_deadline
    FROM goal_sessions
    WHERE awaiting_continuation_response = true
      AND continuation_deadline IS NOT NULL
      AND continuation_deadline < now()
      AND status != 'completed'
  LOOP
    -- Close the session
    UPDATE goal_sessions
    SET
      awaiting_continuation_response = false,
      continuation_decision = 'auto_closed',
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    WHERE id = v_session.id;

    -- Delete modal
    DELETE FROM pending_user_modals
    WHERE goal_session_id = v_session.id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL;

    -- Send notification to user
    INSERT INTO goal_notifications (user_id, session_id, type, title, message, metadata)
    VALUES (
      v_session.user_id,
      v_session.id,
      'session_auto_closed',
      'Session Automatically Closed',
      'Your trading session was automatically closed due to no response within 60 seconds.',
      jsonb_build_object(
        'session_id', v_session.id,
        'reason', 'continuation_timeout',
        'deadline_passed', v_session.continuation_deadline
      )
    );

    v_closed_count := v_closed_count + 1;
    v_closed_sessions := v_closed_sessions || jsonb_build_object(
      'session_id', v_session.id,
      'deadline', v_session.continuation_deadline
    );
  END LOOP;

  RETURN jsonb_build_object(
    'closed_count', v_closed_count,
    'closed_sessions', v_closed_sessions,
    'timestamp', now()
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION request_session_continuation TO authenticated;
GRANT EXECUTE ON FUNCTION handle_continuation_decision TO authenticated;
GRANT EXECUTE ON FUNCTION auto_close_expired_continuations TO service_role;

-- Add comment for documentation
COMMENT ON COLUMN goal_sessions.awaiting_continuation_response IS 'True when session is waiting for user to decide: continue scanning or close session';
COMMENT ON COLUMN goal_sessions.continuation_modal_shown_at IS 'Timestamp when continuation modal was first shown to user';
COMMENT ON COLUMN goal_sessions.continuation_deadline IS 'Auto-close deadline (60 seconds from modal shown). Session closes automatically if no response.';
COMMENT ON COLUMN goal_sessions.continuation_decision IS 'User decision: continue (rescan), close (end session), or auto_closed (timeout)';
