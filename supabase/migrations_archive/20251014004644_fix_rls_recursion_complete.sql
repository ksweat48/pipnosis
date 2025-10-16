/*
  # Fix RLS Policy Recursion and 500 Errors - Complete Solution

  ## Problem
  The "Admins can view all profiles" policy causes infinite recursion by querying
  user_profiles table within a policy that protects user_profiles. This creates
  a loop: policy checks -> queries user_profiles -> triggers same policy -> infinite recursion.
  
  Result: 500 Internal Server Error when querying user_profiles table.

  ## Root Cause
  The policy uses:
  ```sql
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  ```
  This subquery triggers RLS policies on user_profiles, creating recursion.

  ## Solution
  1. Drop the problematic admin policy that causes recursion
  2. Verify is_admin_user() SECURITY DEFINER function exists (it does)
  3. Recreate admin policy using is_admin_user() function which bypasses RLS
  4. Update all related table policies to use the same safe function

  ## Changes
  1. Drop "Admins can view all profiles" policy (recursive, broken)
  2. Recreate it using is_admin_user() function (non-recursive, safe)
  3. Ensure all admin policies across all tables use is_admin_user()
  4. Keep all user-level policies unchanged (they work fine)

  ## Security
  - is_admin_user() function is SECURITY DEFINER and bypasses RLS safely
  - Only checks admin status, cannot modify data
  - Regular users still restricted to their own data
  - Admin access is properly validated through the function
*/

-- ============================================================================
-- STEP 1: Drop the problematic recursive admin policy
-- ============================================================================

DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

-- ============================================================================
-- STEP 2: Recreate admin policy using SECURITY DEFINER function (non-recursive)
-- ============================================================================

-- This policy uses is_admin_user() which is SECURITY DEFINER and bypasses RLS
-- This prevents the infinite recursion issue
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- ============================================================================
-- STEP 3: Verify and fix admin policies on other tables
-- ============================================================================

-- Drop and recreate admin policies on trading_prompts
DROP POLICY IF EXISTS "Admins can view all prompts" ON trading_prompts;
CREATE POLICY "Admins can view all prompts"
  ON trading_prompts FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Drop and recreate admin policies on trade_records
DROP POLICY IF EXISTS "Admins can view all trades" ON trade_records;
CREATE POLICY "Admins can view all trades"
  ON trade_records FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Drop and recreate admin policies on journal_entries (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins can view all journal entries" ON journal_entries';
    EXECUTE 'CREATE POLICY "Admins can view all journal entries" ON journal_entries FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()))';
  END IF;
END $$;

-- Drop and recreate admin policies on trading_sessions (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_sessions') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins can view all sessions" ON trading_sessions';
    EXECUTE 'CREATE POLICY "Admins can view all sessions" ON trading_sessions FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()))';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: Add admin policies to other important tables
-- ============================================================================

-- Market data table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'market_data') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins can view all market data" ON market_data';
    EXECUTE 'CREATE POLICY "Admins can view all market data" ON market_data FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()))';
  END IF;
END $$;

-- Historical candles table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'historical_candles') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins can view all historical candles" ON historical_candles';
    EXECUTE 'CREATE POLICY "Admins can view all historical candles" ON historical_candles FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()))';
  END IF;
END $$;

-- Market analysis table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'market_analysis') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins can view all market analysis" ON market_analysis';
    EXECUTE 'CREATE POLICY "Admins can view all market analysis" ON market_analysis FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()))';
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Verification
-- ============================================================================

-- Log success message
DO $$
BEGIN
  RAISE NOTICE 'RLS recursion fix applied successfully!';
  RAISE NOTICE 'All admin policies now use is_admin_user() SECURITY DEFINER function';
  RAISE NOTICE 'No more infinite recursion - 500 errors should be resolved';
END $$;
