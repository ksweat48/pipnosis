/*
  # Emergency Fix: Remove Infinite Recursion RLS Policies

  ## Critical Issue
  The admin RLS policies created in 20260211_fix_admin_club_dashboard_rls_policies
  are causing infinite recursion:
  
  "infinite recursion detected in policy for relation user_profiles"
  
  ## Root Cause
  The policy checks admin status by querying user_profiles:
  ```sql
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  ```
  
  This creates infinite recursion because:
  1. Query user_profiles to check admin status
  2. RLS policy on user_profiles triggers
  3. Policy queries user_profiles to check admin status
  4. Loop continues infinitely
  
  ## Immediate Fix
  Drop the problematic policies to restore system functionality.
  
  ## Proper Solution (Next Migration)
  Use a separate function or table lookup that doesn't trigger RLS on user_profiles.
*/

-- ============================================================================
-- Drop problematic admin policies
-- ============================================================================

DROP POLICY IF EXISTS "Admins can view all token balances" ON club_token_balances;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Removed infinite recursion RLS policies';
  RAISE NOTICE '⚠️ Admin dashboard will not work until proper solution is implemented';
  RAISE NOTICE '⚠️ System functionality restored for all users';
END $$;
