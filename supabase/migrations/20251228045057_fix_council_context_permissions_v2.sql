/*
  # Fix Council Context Function Permissions
  
  1. Problem
    - Functions `get_latest_council_context` and `store_council_context` return 404 errors
    - Missing GRANT EXECUTE permissions for authenticated users
    
  2. Solution
    - Grant EXECUTE permissions to authenticated role for both functions
    - This allows Alpha to store and retrieve council context
*/

-- Grant execute permissions for council context functions
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION store_council_context(
  uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO authenticated;
