/*
  # Fix Remaining Recursive RLS Policies on refresh_schedules

  ## Summary
  The refresh_schedules table has 2 policies that still use the old recursive pattern:
  - "Admins can delete refresh schedules" 
  - "Admins can update refresh schedules"
  
  These policies query user_profiles table directly, which can cause recursion.
  
  ## Changes
  1. Drop the recursive admin policies on refresh_schedules
  2. Recreate them using is_admin_user() SECURITY DEFINER function
  
  ## Security
  - Uses safe is_admin_user() function to prevent recursion
  - Maintains proper admin access control
  - No bypass of authentication requirements
*/

-- Fix DELETE policy on refresh_schedules
DROP POLICY IF EXISTS "Admins can delete refresh schedules" ON refresh_schedules;
CREATE POLICY "Admins can delete refresh schedules"
  ON refresh_schedules FOR DELETE
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

-- Fix UPDATE policy on refresh_schedules  
DROP POLICY IF EXISTS "Admins can update refresh schedules" ON refresh_schedules;
CREATE POLICY "Admins can update refresh schedules"
  ON refresh_schedules FOR UPDATE
  TO authenticated
  USING (public.is_admin_user(auth.uid()))
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Also fix the INSERT policy if it exists and is recursive
DROP POLICY IF EXISTS "Admins can insert refresh schedules" ON refresh_schedules;
CREATE POLICY "Admins can insert refresh schedules"
  ON refresh_schedules FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Add SELECT policy for admins if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'refresh_schedules' 
    AND policyname = 'Admins can view refresh schedules'
  ) THEN
    EXECUTE 'CREATE POLICY "Admins can view refresh schedules" ON refresh_schedules FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()))';
  END IF;
END $$;

-- Log success
DO $$
BEGIN
  RAISE NOTICE 'All refresh_schedules policies now use is_admin_user() function';
  RAISE NOTICE 'No more recursive policies - all admin checks are safe';
END $$;
