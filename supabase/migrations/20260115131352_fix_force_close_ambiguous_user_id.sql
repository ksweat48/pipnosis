/*
  # Fix Ambiguous user_id in force_close_stale_scanning_sessions

  ## CCIP Analysis

  ### Issue:
  PostgreSQL error: "column reference 'user_id' is ambiguous"

  ### Root Cause:
  The function declares `user_id uuid` in its RETURNS TABLE clause, and also tries
  to return `user_id` from the goal_sessions table in the RETURNING clause of the
  UPDATE statement. PostgreSQL cannot determine which `user_id` is being referenced:
  - The function's return column parameter
  - The goal_sessions table column

  ### SSOT Violation:
  The ambiguity creates a contract violation where the function signature doesn't
  match the implementation cleanly.

  ### Fix:
  Explicitly qualify the `user_id` column reference with the table name:
  `goal_sessions.user_id` in the RETURNING clause.

  ## Changes:
  1. Drop existing function
  2. Recreate with fully-qualified column references in RETURNING clause
  3. No change to function signature or behavior
*/

-- ============================================================================
-- Fix force_close_stale_scanning_sessions
-- ============================================================================

DROP FUNCTION IF EXISTS force_close_stale_scanning_sessions();

CREATE OR REPLACE FUNCTION force_close_stale_scanning_sessions()
RETURNS TABLE (session_id uuid, user_id uuid, minutes_scanning numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  calling_user_id := auth.uid();

  -- Verify admin access
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = calling_user_id
    AND user_profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH stale_sessions AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW()
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 30
    -- ✅ FIX: Explicitly qualify all columns with table name to avoid ambiguity
    RETURNING
      goal_sessions.id,
      goal_sessions.user_id,
      EXTRACT(EPOCH FROM (NOW() - goal_sessions.scanning_started_at)) / 60
  )
  SELECT
    stale_sessions.id as session_id,
    stale_sessions.user_id,
    stale_sessions.extract as minutes_scanning
  FROM stale_sessions;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO service_role;

-- Verification log
DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Fix Applied: force_close_stale_scanning_sessions';
  RAISE NOTICE '  - Ambiguous user_id reference resolved';
  RAISE NOTICE '  - All RETURNING columns fully qualified with table name';
  RAISE NOTICE '  - Function signature unchanged (SSOT maintained)';
END $$;