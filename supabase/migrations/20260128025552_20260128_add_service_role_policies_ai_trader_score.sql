/*
  # Add Service Role Policies to ai_trader_score

  ## Purpose
  Enable backend reward-engine and autonomous trading systems to access ai_trader_score
  via service_role connection (SUPABASE_SERVICE_ROLE_KEY).

  ## SSOT Compliance
  - Backend operations use service_role for reward calculations
  - All mutations logged to ai_trader_score_audit via trigger
  - Frontend always uses authenticated user (via PostgREST client)

  ## RLS Policies Added
  - Service role SELECT: Read all trader scores
  - Service role UPDATE: Update any trader score (reward engine)
  - Service role INSERT: Create new trader scores (initialization)
*/

DROP POLICY IF EXISTS "Service role can read all trader scores" ON ai_trader_score;
DROP POLICY IF EXISTS "Service role can update all trader scores" ON ai_trader_score;
DROP POLICY IF EXISTS "Service role can insert trader scores" ON ai_trader_score;

CREATE POLICY "Service role can read all trader scores"
  ON ai_trader_score
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can update all trader scores"
  ON ai_trader_score
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert trader scores"
  ON ai_trader_score
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Verify policies are in place
DO $$
DECLARE
  policy_count integer;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'ai_trader_score' AND schemaname = 'public';
  
  IF policy_count >= 6 THEN
    RAISE NOTICE '✅ RLS Policy verification: % policies active on ai_trader_score', policy_count;
    RAISE NOTICE '   Authenticated: SELECT, INSERT, UPDATE';
    RAISE NOTICE '   Service Role: SELECT, INSERT, UPDATE';
  ELSE
    RAISE WARNING '⚠️ RLS Policy count unexpected: % policies found', policy_count;
  END IF;
END $$;
