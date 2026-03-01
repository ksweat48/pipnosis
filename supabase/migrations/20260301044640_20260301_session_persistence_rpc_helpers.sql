/*
  # Session Persistence RPC Helpers

  ## Summary
  Creates helper RPCs needed by the updated autonomous-goal-monitor
  to safely track and increment consecutive error counts per session.

  ## New RPCs

  ### increment_session_consecutive_errors(p_session_id)
  Atomically increments consecutive_errors in goal_session_server_state.
  Used by autonomous-goal-monitor on every processing failure.
  Returns the new error count.

  ## SSOT Compliance
  - goal_session_server_state is the sole source of truth for server-side error tracking
  - Only service_role can increment errors (prevents client manipulation)
*/

-- ============================================================================
-- increment_session_consecutive_errors
-- Atomically increments consecutive_errors for a session.
-- Called by autonomous-goal-monitor on processing failures.
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_session_consecutive_errors(p_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count integer;
BEGIN
  INSERT INTO goal_session_server_state (
    goal_session_id,
    user_id,
    consecutive_errors,
    last_error_at,
    updated_at
  )
  SELECT
    p_session_id,
    gs.user_id,
    1,
    NOW(),
    NOW()
  FROM goal_sessions gs
  WHERE gs.id = p_session_id
  ON CONFLICT (goal_session_id) DO UPDATE
    SET
      consecutive_errors = goal_session_server_state.consecutive_errors + 1,
      last_error_at      = NOW(),
      updated_at         = NOW()
  RETURNING consecutive_errors INTO v_new_count;

  IF v_new_count IS NULL THEN
    v_new_count := 0;
  END IF;

  IF v_new_count >= 10 THEN
    RAISE NOTICE '[increment_session_consecutive_errors] Session % has % consecutive errors — will be excluded from processing queue', p_session_id, v_new_count;
  END IF;

  RETURN v_new_count;
END;
$$;

COMMENT ON FUNCTION increment_session_consecutive_errors IS
  'Atomically increments consecutive_errors for a goal session server state record. '
  'When errors reach 10, get_sessions_for_server_processing() excludes the session. '
  'Use reset_session_consecutive_errors() to unblock after investigating.';

GRANT EXECUTE ON FUNCTION increment_session_consecutive_errors TO service_role;
REVOKE EXECUTE ON FUNCTION increment_session_consecutive_errors FROM authenticated;
REVOKE EXECUTE ON FUNCTION increment_session_consecutive_errors FROM anon;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=== Session Persistence RPC Helpers Verification ===';
  RAISE NOTICE '  increment_session_consecutive_errors: created';
  RAISE NOTICE '  reset_session_consecutive_errors: already created in previous migration';
  RAISE NOTICE '===================================================';
END $$;
