/*
  # Add Service Role SELECT policy for session_intelligence_data
  
  The populate-session-intelligence function may need to read data before upserting.
  This policy allows service role to SELECT from session_intelligence_data.
*/

CREATE POLICY "Service role can read session intelligence"
  ON session_intelligence_data FOR SELECT
  TO service_role
  USING (true);

-- Verify all policies are in place
GRANT SELECT ON session_intelligence_data TO service_role;
GRANT INSERT, UPDATE, DELETE ON session_intelligence_data TO service_role;
