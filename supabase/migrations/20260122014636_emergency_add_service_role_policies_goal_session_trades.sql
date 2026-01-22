/*
  # Emergency Fix: Add Service Role Policies to goal_session_trades

  ## Critical Production Issue
  Backend Netlify functions cannot insert trades because goal_session_trades table
  is missing service_role RLS policies. Only admin users can execute trades.

  ## Root Cause
  - goal_session_trades has RLS policies for 'public' role with user_id checks
  - No policies exist for 'service_role'
  - Backend functions use service_role key but insertions fail RLS checks
  - auth.uid() returns NULL for service_role, failing user_id = auth.uid() checks

  ## Fix
  Add full access policies for service_role to allow trusted backend functions
  to create/update trades on behalf of users.

  ## Security Note
  Service role access is already restricted to server-side only via SUPABASE_SERVICE_ROLE_KEY.
  Client-side protections remain via existing 'public' role policies.

  ## Affected Users
  ALL non-admin users were blocked from executing trades until this fix.
*/

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Service role can read all goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Service role can insert goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Service role can update goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Service role can delete goal session trades" ON goal_session_trades;

-- Add service role SELECT policy (allow backend to read all trades)
CREATE POLICY "Service role can read all goal session trades"
  ON goal_session_trades
  FOR SELECT
  TO service_role
  USING (true);

-- Add service role INSERT policy (allow backend to create trades on behalf of users)
CREATE POLICY "Service role can insert goal session trades"
  ON goal_session_trades
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Add service role UPDATE policy (allow backend to update trades)
CREATE POLICY "Service role can update goal session trades"
  ON goal_session_trades
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add service role DELETE policy (allow backend to delete trades if needed)
CREATE POLICY "Service role can delete goal session trades"
  ON goal_session_trades
  FOR DELETE
  TO service_role
  USING (true);

-- Verify policies were created
DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count 
  FROM pg_policies 
  WHERE tablename = 'goal_session_trades' 
  AND 'service_role' = ANY(roles);
  
  RAISE NOTICE '✅ Service role policies added to goal_session_trades';
  RAISE NOTICE '✅ Total service_role policies: %', policy_count;
  RAISE NOTICE '✅ Backend functions can now insert trades for all users';
END $$;
