/*
  # Fix AI Global Tables RLS Policies

  ## Problem
  The AI global learning tables have RLS policies that only allow:
  - authenticated users to SELECT (read)
  - service_role to do ALL operations
  
  But the application code (running as authenticated user) tries to INSERT/UPDATE
  learning data, which gets blocked by RLS, causing 403/42501 errors.

  ## Tables Affected
  - ai_global_patterns
  - ai_global_symbol_intelligence
  - ai_global_market_scenarios
  - ai_global_setup_library

  ## Solution
  Add INSERT and UPDATE policies for authenticated users on these tables.
  These are GLOBAL learning tables where all users contribute to shared intelligence.

  ## Security
  - Users can read all global patterns (already exists)
  - Users can insert new patterns (new)
  - Users can update existing patterns (new)
  - Service role retains full access
*/

-- AI Global Patterns - Add write policies
DROP POLICY IF EXISTS "Authenticated users can insert patterns" ON ai_global_patterns;
DROP POLICY IF EXISTS "Authenticated users can update patterns" ON ai_global_patterns;

CREATE POLICY "Authenticated users can insert patterns"
  ON ai_global_patterns
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update patterns"
  ON ai_global_patterns
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- AI Global Symbol Intelligence - Add write policies
DROP POLICY IF EXISTS "Authenticated users can insert symbol intelligence" ON ai_global_symbol_intelligence;
DROP POLICY IF EXISTS "Authenticated users can update symbol intelligence" ON ai_global_symbol_intelligence;

CREATE POLICY "Authenticated users can insert symbol intelligence"
  ON ai_global_symbol_intelligence
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update symbol intelligence"
  ON ai_global_symbol_intelligence
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- AI Global Market Scenarios - Add write policies
DROP POLICY IF EXISTS "Authenticated users can insert market scenarios" ON ai_global_market_scenarios;
DROP POLICY IF EXISTS "Authenticated users can update market scenarios" ON ai_global_market_scenarios;

CREATE POLICY "Authenticated users can insert market scenarios"
  ON ai_global_market_scenarios
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update market scenarios"
  ON ai_global_market_scenarios
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- AI Global Setup Library - Add write policies
DROP POLICY IF EXISTS "Authenticated users can insert setups" ON ai_global_setup_library;
DROP POLICY IF EXISTS "Authenticated users can update setups" ON ai_global_setup_library;

CREATE POLICY "Authenticated users can insert setups"
  ON ai_global_setup_library
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update setups"
  ON ai_global_setup_library
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
