/*
  # Fix user_max_risk_preferences INSERT Policy

  ## Problem
  Users getting 403 Forbidden when trying to insert their own risk preferences
  Error: "new row violates row-level security policy"
  
  ## Root Cause
  Missing INSERT policy for authenticated users
  Table has SELECT and UPDATE policies, but no INSERT policy
  
  ## Solution
  Add INSERT policy allowing users to create their own preference row
  
  ## SSOT Compliance
  - user_max_risk_preferences table is SSOT for user risk settings
  - Policy ensures users can only insert their own preferences
  - Prevents users from creating preferences for other users
  
  ## Security
  - Users can ONLY insert rows where user_id = auth.uid()
  - Cannot impersonate or modify other users' preferences
  - Service role retains full access for admin operations
*/

-- Add INSERT policy for authenticated users
CREATE POLICY "Users can insert own max risk preference"
  ON user_max_risk_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Verify policy was created
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_max_risk_preferences'
    AND policyname = 'Users can insert own max risk preference'
    AND cmd = 'INSERT'
  ) INTO policy_exists;

  IF policy_exists THEN
    RAISE NOTICE '✅ INSERT policy created successfully';
  ELSE
    RAISE WARNING '⚠️ INSERT policy creation may have failed';
  END IF;
END $$;