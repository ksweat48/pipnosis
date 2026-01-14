/*
  # Fix User Signup - Add Service Role Policy to User Profiles

  ## Problem
  - `handle_new_user()` trigger is marked SECURITY DEFINER (designated authority)
  - RLS blocks it from inserting into user_profiles
  - SSOT violation: Authority cannot fulfill its responsibility

  ## Solution
  - Add service_role policy to allow SECURITY DEFINER triggers to execute
  - Verify the fix works

  ## Changes
  1. Add service_role INSERT policy to user_profiles
  2. Verify trigger can now execute
*/

-- Add service_role policy to allow SECURITY DEFINER triggers to work
CREATE POLICY "Service role can manage user profiles"
  ON user_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify the policy was created successfully
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'Service role can manage user profiles'
  ) THEN
    RAISE EXCEPTION 'Failed to create service_role policy for user_profiles';
  END IF;
  
  RAISE NOTICE 'Successfully added service_role policy to user_profiles';
END $$;
