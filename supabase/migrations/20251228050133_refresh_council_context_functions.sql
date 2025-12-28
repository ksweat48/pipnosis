/*
  # Refresh Council Context Functions Schema Cache

  1. Problem
    - Functions `get_latest_council_context` and `store_council_context` return 404 errors
    - PostgREST schema cache not updated after permission grants

  2. Solution
    - Notify PostgREST to reload schema cache
    - Verify function signatures and permissions are correct
*/

-- Ensure functions exist and have correct signatures
DO $$
BEGIN
  -- Verify get_latest_council_context exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_latest_council_context'
  ) THEN
    RAISE EXCEPTION 'Function get_latest_council_context does not exist';
  END IF;

  -- Verify store_council_context exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'store_council_context'
  ) THEN
    RAISE EXCEPTION 'Function store_council_context does not exist';
  END IF;
END $$;

-- Re-grant permissions explicitly to ensure they're set
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO anon;

GRANT EXECUTE ON FUNCTION store_council_context(
  uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO authenticated;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- Add comment to track cache refresh
COMMENT ON FUNCTION get_latest_council_context IS 'Retrieves the latest council context for Alpha Scout - Schema cache refreshed 2025-12-28';
COMMENT ON FUNCTION store_council_context IS 'Stores or updates council context after full council meeting - Schema cache refreshed 2025-12-28';
