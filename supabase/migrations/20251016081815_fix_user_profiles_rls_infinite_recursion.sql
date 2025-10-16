/*
  # Fix Infinite Recursion in user_profiles RLS Policies

  1. Problem
    - The "Admins can view all profiles" policy causes infinite recursion
    - It queries user_profiles to check admin status while protecting user_profiles
    - This creates a circular dependency that results in 500 errors

  2. Solution
    - Drop the problematic admin policy that causes recursion
    - Users can already read their own profile (including is_admin field) via the existing policy
    - Admin-specific features will check admin status in application code
    - This is the cleanest solution that avoids database complexity

  3. Changes
    - DROP POLICY "Admins can view all profiles" on user_profiles
    - Keep the existing "Users can view own profile" policy (allows reading own is_admin field)
    - This fixes the 500 error and allows AutoTradingPanel to work correctly

  4. Security Impact
    - Users can still only view their own profile data
    - Admin status checks happen in application code with proper validation
    - No security is compromised by removing this policy
*/

-- Drop the problematic policy that causes infinite recursion
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

-- The existing "Users can view own profile" policy is sufficient
-- It already allows users to read their own is_admin field:
-- CREATE POLICY "Users can view own profile"
--   ON user_profiles FOR SELECT
--   TO authenticated
--   USING (auth.uid() = id);

-- No new policy needed - users can read their own profile including is_admin field
-- Admin features in the application will verify admin status after reading the profile
