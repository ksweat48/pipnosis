/*
  # Remove Alpha Scout System

  1. Purpose
    - Complete removal of Alpha Scout cost-optimization system
    - Simplifies codebase by always running Full Omega Council
    - Eliminates 404 errors from missing database functions
    - Trade-off: Increases LLM API calls but improves reliability

  2. What's Being Removed
    - `council_context` table (stored scout context and improvement tracking)
    - `store_council_context()` function
    - `get_latest_council_context()` function
    - `increment_scout_cycle()` function

  3. Impact
    - Frontend now calls alphaOmegaOrchestrator directly
    - Every scan runs full 7-brain Omega Council
    - No more cached context or scout cycles
    - More consistent and predictable behavior

  4. Security
    - Cascade deletion handled by foreign keys
    - No orphaned data left behind
*/

-- Drop all council_context related functions
DROP FUNCTION IF EXISTS increment_scout_cycle(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS get_latest_council_context(uuid, uuid);
DROP FUNCTION IF EXISTS store_council_context(
  uuid, uuid, text, numeric, numeric, numeric,
  jsonb, jsonb, jsonb, text[], integer
);

-- Drop council_context table
-- CASCADE will handle any dependencies
DROP TABLE IF EXISTS council_context CASCADE;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Alpha Scout system successfully removed';
  RAISE NOTICE '   - council_context table dropped';
  RAISE NOTICE '   - 3 database functions dropped';
  RAISE NOTICE '   - System now uses direct Omega Council calls';
END $$;
