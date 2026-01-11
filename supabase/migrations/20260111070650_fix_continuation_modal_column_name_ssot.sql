/*
  # Fix Continuation Modal Column Name SSOT Violation

  1. Problem
    - request_session_continuation() inserts into goal_notifications with column 'session_id'
    - But goal_notifications table uses 'goal_session_id' (established in earlier migrations)
    - This causes SQL error, modal never appears, loop continues forever

  2. Solution
    - Update request_session_continuation() to use correct column name: goal_session_id
    - This is a CRITICAL SSOT fix - one table, one column name, no exceptions

  3. Impact
    - Continuation modals will now properly appear when intents are abandoned
    - User gets the choice to continue or close session
    - Prevents infinite loop of creating doomed intents
*/

-- Drop existing function first
DROP FUNCTION IF EXISTS request_session_continuation(UUID, TEXT);

-- Recreate with correct column name
CREATE FUNCTION request_session_continuation(
  p_session_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_deadline TIMESTAMPTZ;
  v_seconds_remaining INTEGER;
BEGIN
  -- Get user_id from session
  SELECT user_id INTO v_user_id
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  -- Set 60-second deadline for user response
  v_deadline := NOW() + INTERVAL '60 seconds';
  v_seconds_remaining := 60;

  -- Update session status to 'awaiting_continuation' (pauses session)
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    entry_monitor_state = 'ABANDONED_RESCAN_REQUESTED',
    continuation_deadline = v_deadline,
    updated_at = NOW()
  WHERE id = p_session_id;

  -- CRITICAL FIX: Use goal_session_id (not session_id)
  -- goal_notifications table schema uses 'goal_session_id' column
  INSERT INTO goal_notifications (
    user_id,
    goal_session_id,  -- ✅ CORRECT column name
    type,
    title,
    message,
    metadata
  )
  VALUES (
    v_user_id,
    p_session_id,
    'continuation_modal',
    'Entry Monitoring Abandoned',
    format('Entry intent was abandoned: %s. Would you like to continue scanning or end this session?', p_reason),
    jsonb_build_object(
      'reason', p_reason,
      'deadline', v_deadline,
      'seconds_remaining', v_seconds_remaining,
      'action_required', true
    )
  );

  -- Create push notification
  PERFORM send_push_notification(
    v_user_id,
    'Session Decision Required',
    format('Entry monitoring was abandoned (%s). Continue scanning?', p_reason),
    jsonb_build_object(
      'type', 'continuation_modal',
      'session_id', p_session_id,
      'reason', p_reason,
      'deadline', v_deadline
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'deadline', v_deadline,
    'seconds_remaining', v_seconds_remaining
  );
END;
$$;
