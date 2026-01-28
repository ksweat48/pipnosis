/*
  # Fix entry_intents RLS SELECT policies

  ## Problem
  trade-closure-coordinator queries entry_intents to check for active intents.
  These queries fail due to missing/incorrect RLS SELECT policies.

  ## Solution
  Add SELECT policies properly scoped by user_id
*/

-- Ensure RLS is enabled
ALTER TABLE entry_intents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read own entry intents" ON entry_intents;
DROP POLICY IF EXISTS "Service role reads all intents" ON entry_intents;
DROP POLICY IF EXISTS "Service role can read all entry intents" ON entry_intents;
DROP POLICY IF EXISTS "Authenticated users can read own intents" ON entry_intents;
DROP POLICY IF EXISTS "Authenticated users can read own entry intents" ON entry_intents;

-- Add SELECT policy for authenticated users (own intents only)
CREATE POLICY "Users can read own entry intents"
  ON entry_intents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Add SELECT policy for service role (all intents for system operations)
CREATE POLICY "Service role reads all intents"
  ON entry_intents
  FOR SELECT
  TO service_role
  USING (true);

-- Verify policies
DO $$
BEGIN
  RAISE NOTICE '✅ entry_intents RLS SELECT policies configured';
  RAISE NOTICE '  - Authenticated users can read their own intents';
  RAISE NOTICE '  - Service role can read all intents for coordinator operations';
  RAISE NOTICE '✅ trade-closure-coordinator queries will now succeed';
END $$;
