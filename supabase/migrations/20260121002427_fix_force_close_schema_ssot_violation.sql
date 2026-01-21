/*
  # Fix force_close_stale_scanning_sessions Schema SSOT Violation

  ## CCIP Root Cause Analysis

  ### Critical Issue:
  PostgreSQL error: "column 'awaiting_continuation_confirmation' of relation 'goal_sessions' does not exist"

  ### Root Cause:
  The function was written with incorrect column names that don't exist in the actual schema:
  - `awaiting_continuation_confirmation` ❌ DOES NOT EXIST
  - `continuation_confirmation_expires_at` ❌ DOES NOT EXIST

  Actual schema has:
  - `awaiting_continuation_since` ✅ EXISTS (timestamp with time zone)

  ### SSOT Violation:
  This is a database schema contract violation where the function's expectations
  don't match the actual table structure. This breaks the Single Source of Truth
  principle - the function assumes a schema that doesn't exist.

  ### CCIP Compliance:
  1. ✅ System Map: Verified actual goal_sessions schema
  2. ✅ Logic Contract: Function should clear continuation state on force-close
  3. ✅ Dry-Run: Tested column existence via information_schema
  4. ✅ Compatibility: No breaking changes to function signature or behavior
  5. ✅ Staged: Production-safe - only fixes column references
  6. ✅ Verification: Function will now execute without 42703 errors

  ### Fix:
  Update the function to use the correct column name:
  - Set `awaiting_continuation_since = NULL` (clear continuation state)
  - Remove references to non-existent columns

  ## Changes:
  1. Replace `awaiting_continuation_confirmation = false` with `awaiting_continuation_since = NULL`
  2. Remove `continuation_confirmation_expires_at = NULL` (column doesn't exist)
  3. Maintain all other logic unchanged (SSOT preserved)
  4. No change to function signature or return type
*/

-- ============================================================================
-- Fix force_close_stale_scanning_sessions - SSOT Schema Compliance
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
      -- ✅ SSOT FIX: Use correct column name
      awaiting_continuation_since = NULL,
      -- ✅ SSOT FIX: Removed non-existent column reference
      updated_at = NOW()
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 30
    RETURNING
      goal_sessions.id,
      goal_sessions.user_id,
      EXTRACT(EPOCH FROM (NOW() - goal_sessions.scanning_started_at)) / 60 as minutes_scanning
  )
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

-- Governance compliance log
DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Schema SSOT Fix Applied: force_close_stale_scanning_sessions';
  RAISE NOTICE '  - Fixed column: awaiting_continuation_confirmation → awaiting_continuation_since';
  RAISE NOTICE '  - Removed non-existent column: continuation_confirmation_expires_at';
  RAISE NOTICE '  - Schema contract now matches actual database structure';
  RAISE NOTICE '  - SSOT Principle: Function matches database reality';
  RAISE NOTICE '  - Governance: No breaking changes to function signature';
END $$;
