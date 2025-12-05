/*
  # Fix Omega-8 Hybrid Usage Insert Policy
  
  ## Problem
  The omega8_hybrid_usage table only allows service_role to insert records.
  When Omega-8 runs in the browser, it needs authenticated users to be able
  to log their usage for analytics.
  
  ## Solution
  - Add INSERT policy for authenticated users to log their own usage
  - Users can only insert records with their own user_id
  
  ## Changes
  1. Add authenticated user INSERT policy
*/

-- Drop existing policy if it exists (ignore error if not found)
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Users can insert own omega8 usage" ON omega8_hybrid_usage;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Allow authenticated users to insert their own omega8 usage
CREATE POLICY "Users can insert own omega8 usage"
  ON omega8_hybrid_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);