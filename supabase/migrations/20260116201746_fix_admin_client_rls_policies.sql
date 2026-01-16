/*
  # Fix Admin Client RLS Policies for Client-Side Operations

  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  Client-side code (alpha-thought-stream.ts, scan-results-manager.ts) attempts
  to use admin client (service role) to bypass RLS, but service role key should
  NEVER exist in browser environment.

  Current behavior:
  - Code tries admin client, falls back to regular client
  - Logs CRITICAL errors when admin unavailable (expected in browser)
  - RLS policies block legitimate user operations
  - "Forensics logging will fail" errors in production

  ## Root Cause
  RLS policies too restrictive - don't allow authenticated users to insert
  their own data. Operations incorrectly assumed to need RLS bypass.

  ## Solution (SSOT & CCIP Compliant)
  1. Update RLS policies to allow authenticated users to insert own data
  2. Maintain service role bypass for server-side batch operations
  3. No breaking changes - both paths continue to work
  4. Code will work seamlessly with regular client (no admin needed)

  ## Changes
  1. `alpha_scan_thoughts`: Add INSERT policy for authenticated users
  2. `goal_session_scan_results`: Add INSERT policy for authenticated users
  3. Both maintain existing SELECT/UPDATE policies
  4. Service role policies unchanged (still has full access)

  ## Security Impact
  ✅ SAFE: Users can only insert data for themselves (WHERE auth.uid() = user_id)
  ✅ SAFE: Cannot insert for other users
  ✅ SAFE: Cannot modify other users' data
  ✅ SAFE: Service role retains full access for server-side operations

  ═══════════════════════════════════════════════════════════════════════════
*/

-- ============================================================================
-- PART 1: Fix alpha_scan_thoughts RLS Policies
-- ============================================================================

-- Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Authenticated users can insert own scan thoughts"
  ON alpha_scan_thoughts;

-- Create comprehensive INSERT policy for authenticated users
CREATE POLICY "Authenticated users can insert own scan thoughts"
  ON alpha_scan_thoughts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Verify existing policies remain intact
DO $$
BEGIN
  -- Check SELECT policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alpha_scan_thoughts'
    AND policyname LIKE '%can view own%'
  ) THEN
    RAISE WARNING 'SELECT policy missing for alpha_scan_thoughts';
  END IF;

  -- Check UPDATE policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alpha_scan_thoughts'
    AND cmd = 'UPDATE'
  ) THEN
    RAISE WARNING 'UPDATE policy missing for alpha_scan_thoughts';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Fix goal_session_scan_results RLS Policies
-- ============================================================================

-- Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Authenticated users can insert own scan results"
  ON goal_session_scan_results;

-- Create comprehensive INSERT policy for authenticated users
CREATE POLICY "Authenticated users can insert own scan results"
  ON goal_session_scan_results
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Verify existing policies remain intact
DO $$
BEGIN
  -- Check SELECT policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_session_scan_results'
    AND cmd = 'SELECT'
  ) THEN
    RAISE WARNING 'SELECT policy missing for goal_session_scan_results';
  END IF;
END $$;

-- ============================================================================
-- PART 3: Verification and Comments
-- ============================================================================

COMMENT ON POLICY "Authenticated users can insert own scan thoughts"
  ON alpha_scan_thoughts IS
'Allows authenticated users to insert their own scan thoughts without requiring
admin/service role client. Users can only insert data where user_id matches
their auth.uid(). Service role bypass still works for server-side operations.';

COMMENT ON POLICY "Authenticated users can insert own scan results"
  ON goal_session_scan_results IS
'Allows authenticated users to insert their own scan results without requiring
admin/service role client. Users can only insert data where user_id matches
their auth.uid(). Service role bypass still works for server-side operations.';

-- Final verification
DO $$
DECLARE
  v_thoughts_policies integer;
  v_results_policies integer;
BEGIN
  -- Count policies for alpha_scan_thoughts
  SELECT COUNT(*) INTO v_thoughts_policies
  FROM pg_policies
  WHERE tablename = 'alpha_scan_thoughts';

  -- Count policies for goal_session_scan_results
  SELECT COUNT(*) INTO v_results_policies
  FROM pg_policies
  WHERE tablename = 'goal_session_scan_results';

  RAISE NOTICE 'alpha_scan_thoughts has % RLS policies', v_thoughts_policies;
  RAISE NOTICE 'goal_session_scan_results has % RLS policies', v_results_policies;

  IF v_thoughts_policies = 0 THEN
    RAISE EXCEPTION 'CRITICAL: No RLS policies on alpha_scan_thoughts!';
  END IF;

  IF v_results_policies = 0 THEN
    RAISE EXCEPTION 'CRITICAL: No RLS policies on goal_session_scan_results!';
  END IF;

  RAISE NOTICE '✅ RLS policies successfully updated for client-side operations';
END $$;
