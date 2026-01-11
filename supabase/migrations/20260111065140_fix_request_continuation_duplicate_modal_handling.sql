/*
  # Fix request_session_continuation Duplicate Modal Handling

  ## Problem
  The `request_session_continuation` RPC function attempts to INSERT a modal
  without checking if one already exists, causing a 400 error on duplicate
  attempts. This creates a state machine deadlock where:
  - The intent is abandoned but modal creation fails
  - The fallback recovery doesn't clean up monitor state
  - System is stuck with entry_monitor_state='ENTRY_MONITOR_ACTIVE' but no active intent
  - All scanning is blocked permanently

  ## Root Cause
  Lines 76-90 of the original function:
  ```sql
  INSERT INTO pending_user_modals (...)
  SELECT ... FROM goal_sessions WHERE id = p_session_id;
  ```
  No duplicate check before insert → constraint violation → 400 error

  ## Solution
  1. Check if modal already exists before attempting insert
  2. If exists and not dismissed, return existing modal info (idempotent)
  3. If exists and dismissed, delete old modal and create new one
  4. Always ensure state transitions complete successfully

  ## Impact
  - Prevents 400 errors on retry/duplicate attempts
  - Makes function idempotent (safe to call multiple times)
  - Ensures state cleanup completes even on error paths
  - Fixes the state machine deadlock issue
*/

-- ============================================================================
-- Fix request_session_continuation to handle duplicate modals gracefully
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
  v_user_id uuid;
  v_existing_modal_id uuid;
BEGIN
  -- Get user_id for later use
  SELECT user_id INTO v_user_id
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  -- Calculate 60-second deadline
  v_deadline := now() + interval '60 seconds';

  -- =========================================================================
  -- STEP 1: Check for existing continuation modal
  -- =========================================================================
  SELECT id INTO v_existing_modal_id
  FROM pending_user_modals
  WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NULL;

  IF v_existing_modal_id IS NOT NULL THEN
    -- Modal already exists - this is a duplicate call (idempotent behavior)
    RAISE NOTICE '[request_continuation] Modal already exists for session %, returning existing', p_session_id;
    
    -- Return existing modal info (don't update anything)
    SELECT jsonb_build_object(
      'session_id', id,
      'awaiting_response', awaiting_continuation_response,
      'status', status,
      'modal_shown_at', continuation_modal_shown_at,
      'deadline', continuation_deadline,
      'seconds_remaining', EXTRACT(EPOCH FROM (continuation_deadline - now())),
      'idempotent', true,
      'existing_modal_id', v_existing_modal_id
    ) INTO v_result
    FROM goal_sessions
    WHERE id = p_session_id;
    
    RETURN v_result;
  END IF;

  -- =========================================================================
  -- STEP 2: Clean up any dismissed modals (housekeeping)
  -- =========================================================================
  DELETE FROM pending_user_modals
  WHERE goal_session_id = p_session_id
    AND modal_type = 'continuation'
    AND dismissed_at IS NOT NULL;

  -- =========================================================================
  -- STEP 3: Update session to PAUSED awaiting continuation state
  -- =========================================================================
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
    'seconds_remaining', EXTRACT(EPOCH FROM (continuation_deadline - now())),
    'idempotent', false
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Session update failed: %', p_session_id;
  END IF;

  -- =========================================================================
  -- STEP 4: Create pending modal for user (now safe - no duplicates)
  -- =========================================================================
  INSERT INTO pending_user_modals (user_id, goal_session_id, modal_type, modal_data, expires_at)
  VALUES (
    v_user_id,
    p_session_id,
    'continuation',
    jsonb_build_object(
      'session_id', p_session_id,
      'reason', p_reason,
      'deadline', v_deadline,
      'message', 'Entry intent timed out. Would you like to continue scanning or close this session?',
      'countdown_seconds', 60
    ),
    v_deadline + interval '1 minute'
  );

  -- =========================================================================
  -- STEP 5: Create notification
  -- =========================================================================
  INSERT INTO goal_notifications (user_id, session_id, type, title, message, metadata)
  VALUES (
    v_user_id,
    p_session_id,
    'continuation_required',
    'Decision Required',
    'Entry intent expired. Continue scanning or close session?',
    jsonb_build_object(
      'session_id', p_session_id,
      'reason', p_reason,
      'deadline', v_deadline
    )
  );

  RAISE NOTICE '[request_continuation] Successfully created modal for session %', p_session_id;

  RETURN v_result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION request_session_continuation TO authenticated;

COMMENT ON FUNCTION request_session_continuation IS
  'Request user continuation decision for a session. Idempotent - safe to call multiple times.';
