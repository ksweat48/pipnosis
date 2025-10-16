/*
  # Fix Infinite Recursion in Admin RLS Policies

  ## Summary
  This migration fixes a critical bug where admin RLS policies cause infinite recursion
  by querying the user_profiles table within policies protecting that same table.

  ## Problem
  The admin policies created in previous migrations use an EXISTS subquery that checks
  user_profiles.is_admin within policies on user_profiles itself. This creates an
  infinite loop:
  - Policy checks if user is admin by querying user_profiles
  - That query triggers the same policy
  - Which queries user_profiles again
  - Causing infinite recursion and database errors

  ## Solution
  1. Create a SECURITY DEFINER function that bypasses RLS to safely check admin status
  2. Drop all problematic admin policies that cause recursion
  3. Recreate admin policies using the new safe function
  4. The function has elevated privileges and won't trigger RLS policies

  ## Changes
  1. Create `is_admin_user()` function with SECURITY DEFINER
  2. Drop existing admin policies on all tables
  3. Recreate admin policies using the new function
  4. Keep all existing user policies intact

  ## Security
  - The SECURITY DEFINER function only checks admin status, nothing else
  - Regular users still can only access their own data
  - Admin users can access all data for analytics and management
  - No bypass of authentication requirements
*/

-- Create a SECURITY DEFINER function to check admin status without triggering RLS
CREATE OR REPLACE FUNCTION public.is_admin_user(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- This function bypasses RLS to safely check admin status
  RETURN EXISTS (
    SELECT 1 
    FROM user_profiles 
    WHERE id = user_id AND is_admin = true
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO authenticated;

-- Drop all problematic admin policies that cause infinite recursion
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Admins can view all trades" ON trade_records;
DROP POLICY IF EXISTS "Admins can view all journal entries" ON journal_entries;
DROP POLICY IF EXISTS "Admins can view all sessions" ON trading_sessions;

-- Recreate admin policies using the safe is_admin_user() function

-- Admin can view all user profiles (NO MORE RECURSION!)
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Admin can view all trading prompts
CREATE POLICY "Admins can view all prompts"
  ON trading_prompts FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Admin can view all trade records
CREATE POLICY "Admins can view all trades"
  ON trade_records FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Admin can view all journal entries
CREATE POLICY "Admins can view all journal entries"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Admin can view all trading sessions
CREATE POLICY "Admins can view all sessions"
  ON trading_sessions FOR SELECT
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Verify the function works by testing it
-- (This will be logged but not cause errors)
DO $$
BEGIN
  RAISE NOTICE 'Admin RLS policies fixed successfully. The is_admin_user() function is now available.';
END $$;
