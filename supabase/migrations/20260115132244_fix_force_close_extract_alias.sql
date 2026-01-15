/*
  # Fix EXTRACT Column Alias in force_close_stale_scanning_sessions

  ## CCIP Root Cause Analysis

  ### Cascading Issue:
  The previous fix resolved the ambiguous user_id but introduced a new bug:
  - EXTRACT() is a function expression, not a column
  - Without an alias, PostgreSQL doesn't name the column
  - Attempting to reference stale_sessions.extract fails

  ### Root Cause:
  In the RETURNING clause, the EXTRACT expression had no alias:
  ```sql
  EXTRACT(EPOCH FROM (NOW() - goal_sessions.scanning_started_at)) / 60
  ```

  Then trying to SELECT it as:
  ```sql
  stale_sessions.extract as minutes_scanning  -- extract column doesn't exist
  ```

  ### SSOT Fix:
  Give the EXTRACT expression a proper alias in the CTE RETURNING clause,
  then reference that alias in the SELECT.

  ## Changes:
  1. Add 'as minutes_scanning' alias to EXTRACT in RETURNING
  2. Reference 'stale_sessions.minutes_scanning' in SELECT
  3. No change to function signature (SSOT maintained)
*/

-- ============================================================================
-- Fix force_close_stale_scanning_sessions - Proper Column Aliasing
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
    -- ✅ FIX: Give EXTRACT expression a proper alias
    RETURNING
      goal_sessions.id,
      goal_sessions.user_id,
      EXTRACT(EPOCH FROM (NOW() - goal_sessions.scanning_started_at)) / 60 as minutes_scanning
  )
  -- ✅ FIX: Reference the aliased column correctly
  SELECT
    stale_sessions.id as session_id,
    stale_sessions.user_id,
    stale_sessions.minutes_scanning
  FROM stale_sessions;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO service_role;

-- Verification log
DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Cascading Fix Applied: force_close_stale_scanning_sessions';
  RAISE NOTICE '  - EXTRACT expression properly aliased in RETURNING clause';
  RAISE NOTICE '  - Column reference corrected in SELECT';
  RAISE NOTICE '  - Root cause: Expression without alias cannot be referenced';
END $$;