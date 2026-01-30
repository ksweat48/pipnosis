/*
  # CCIP Emergency Fix: Force Close Function After Continuation Modal Removal

  ## Critical Issue
  
  PostgreSQL Error: `column "scanning_started_at" does not exist`
  
  Function: `force_close_stale_scanning_sessions()`
  Affected: Admin Dashboard "Force Close Stuck Sessions" button
  
  ## Root Cause Analysis
  
  The continuation modal removal migration deleted:
  - ❌ `scanning_started_at` column
  - ❌ `awaiting_continuation_since` column
  
  But the admin force-close function still references these deleted columns,
  causing the admin "Unstuck User" button to fail.
  
  ## SSOT Violation
  
  The function's schema contract was broken when columns were removed without
  updating dependent functions. This violates SSOT principle: the function
  assumes a database structure that no longer exists.
  
  ## Actual Schema (Current State)
  
  ✅ `created_at` - timestamp (NOT NULL) - session creation time
  ✅ `cycle_started_at` - timestamp (NULLABLE) - current cycle start
  ✅ `last_scan_at` - timestamp (NULLABLE) - last successful scan
  
  ## CCIP Compliance Protocol
  
  ### 1. System Map
  - ✅ Verified current goal_sessions schema via information_schema
  - ✅ Identified stuck user: greenmorris.83@gmail.com (864 minutes stuck)
  - ✅ Confirmed deleted columns: scanning_started_at, awaiting_continuation_since
  
  ### 2. Logic Contract
  - Function Purpose: Force-close sessions stuck in scanning/trade_pending > 30 min
  - New Detection Logic: Use `COALESCE(cycle_started_at, created_at)` as time basis
  - This respects the new architecture where sessions scan continuously
  
  ### 3. Dry-Run Simulation
  - Tested query against actual stuck session (14+ hours old)
  - Verified column references exist in current schema
  - Confirmed no breaking changes to function signature
  
  ### 4. Compatibility Check
  - ✅ Function signature unchanged (same params, same return type)
  - ✅ Admin UI requires no changes (just calls the RPC)
  - ✅ No impact on other system components
  
  ### 5. Staged Deployment
  - Single atomic operation: DROP + CREATE FUNCTION
  - Zero downtime (function recreated immediately)
  - Production-safe: only fixes internal logic
  
  ### 6. Post-Deploy Verification
  - Test on greenmorris.83@gmail.com stuck session
  - Verify function executes without 42703 errors
  - Confirm session transitions to 'user_stopped'
  
  ## Changes
  
  1. **Replace** `scanning_started_at` → `COALESCE(cycle_started_at, created_at)`
  2. **Remove** `awaiting_continuation_since = NULL` (column deleted)
  3. **Simplify** UPDATE to only set status and completed_at
  4. **Preserve** all admin verification and security logic
  
  ## Governance Compliance
  
  - ✅ Single Source of Truth: Function matches actual database schema
  - ✅ Change Control: Documented root cause and fix strategy
  - ✅ Intelligence Protocol: No AI/LLM logic affected
  - ✅ Security: Maintains admin-only access control
  - ✅ Audit Trail: Migration logged with full CCIP documentation
*/

-- ============================================================================
-- CCIP Fix: force_close_stale_scanning_sessions - Post-Continuation Removal
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

  -- SSOT: Admin verification (unchanged)
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = calling_user_id
    AND user_profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- SSOT: Force-close stuck sessions using columns that actually exist
  RETURN QUERY
  WITH stale_sessions AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      updated_at = NOW()
      -- ✅ SSOT FIX: Removed references to deleted columns
      -- ❌ OLD: awaiting_continuation_since = NULL (column deleted)
      -- ❌ OLD: scanning_started_at reference (column deleted)
    WHERE status IN ('scanning', 'trade_pending')
      -- ✅ SSOT FIX: Use cycle_started_at or fallback to created_at
      AND COALESCE(cycle_started_at, created_at) IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - COALESCE(cycle_started_at, created_at))) / 60 > 30
    RETURNING
      goal_sessions.id,
      goal_sessions.user_id,
      -- ✅ SSOT FIX: Calculate duration from cycle_started_at or created_at
      EXTRACT(EPOCH FROM (NOW() - COALESCE(goal_sessions.cycle_started_at, goal_sessions.created_at))) / 60 as minutes_scanning
  )
  SELECT
    stale_sessions.id as session_id,
    stale_sessions.user_id,
    stale_sessions.minutes_scanning
  FROM stale_sessions;
END;
$$;

-- Grant permissions (unchanged - SSOT preserved)
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO service_role;

-- ============================================================================
-- CCIP Governance Compliance Log
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '======================================================================';
  RAISE NOTICE '✓ CCIP Emergency Fix Applied: force_close_stale_scanning_sessions';
  RAISE NOTICE '======================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '📋 Root Cause:';
  RAISE NOTICE '   - Continuation modal removal deleted scanning_started_at column';
  RAISE NOTICE '   - Function still referenced deleted column → 42703 error';
  RAISE NOTICE '   - Admin "Unstuck User" button completely broken';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 SSOT Fixes Applied:';
  RAISE NOTICE '   - scanning_started_at → COALESCE(cycle_started_at, created_at)';
  RAISE NOTICE '   - Removed: awaiting_continuation_since = NULL';
  RAISE NOTICE '   - Schema contract now matches actual database structure';
  RAISE NOTICE '';
  RAISE NOTICE '✅ CCIP Compliance:';
  RAISE NOTICE '   - System Map: Verified via information_schema';
  RAISE NOTICE '   - Logic Contract: 30-min timeout preserved';
  RAISE NOTICE '   - Compatibility: Function signature unchanged';
  RAISE NOTICE '   - Staged: Atomic DROP+CREATE operation';
  RAISE NOTICE '   - Verification: Ready for testing on stuck users';
  RAISE NOTICE '';
  RAISE NOTICE '🛡️ Governance:';
  RAISE NOTICE '   - SSOT: Single authority for stuck session detection';
  RAISE NOTICE '   - Security: Admin-only access preserved';
  RAISE NOTICE '   - Audit: Full CCIP documentation included';
  RAISE NOTICE '';
  RAISE NOTICE '======================================================================';
END $$;
