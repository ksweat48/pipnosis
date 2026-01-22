/*
  # Add Service Role Policies to entry_intents and ai_risk_state

  ## Purpose
  Backend monitoring functions need access to these tables for autonomous trading.
  Adding service_role policies to prevent RLS blocking backend operations.

  ## Tables Fixed
  1. entry_intents - Used by autonomous-entry-monitor function
  2. ai_risk_state - Used for risk management by backend functions

  ## Security
  Service role access is server-side only via SUPABASE_SERVICE_ROLE_KEY.
*/

-- entry_intents table policies
DROP POLICY IF EXISTS "Service role can read all entry intents" ON entry_intents;
DROP POLICY IF EXISTS "Service role can insert entry intents" ON entry_intents;
DROP POLICY IF EXISTS "Service role can update entry intents" ON entry_intents;
DROP POLICY IF EXISTS "Service role can delete entry intents" ON entry_intents;

CREATE POLICY "Service role can read all entry intents"
  ON entry_intents
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert entry intents"
  ON entry_intents
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update entry intents"
  ON entry_intents
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete entry intents"
  ON entry_intents
  FOR DELETE
  TO service_role
  USING (true);

-- ai_risk_state table policies
DROP POLICY IF EXISTS "Service role can read all ai risk state" ON ai_risk_state;
DROP POLICY IF EXISTS "Service role can insert ai risk state" ON ai_risk_state;
DROP POLICY IF EXISTS "Service role can update ai risk state" ON ai_risk_state;
DROP POLICY IF EXISTS "Service role can delete ai risk state" ON ai_risk_state;

CREATE POLICY "Service role can read all ai risk state"
  ON ai_risk_state
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert ai risk state"
  ON ai_risk_state
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update ai risk state"
  ON ai_risk_state
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete ai risk state"
  ON ai_risk_state
  FOR DELETE
  TO service_role
  USING (true);
