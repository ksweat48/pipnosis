/*
  # Force PostgREST to Recognize Council Context Functions

  ## Problem
    - Functions exist in database but PostgREST returns 404
    - Schema cache not recognizing the functions
    - Edge Function calls fail with "function not found in schema cache"

  ## Solution
    1. Verify functions exist with correct signatures
    2. Revoke and re-grant all permissions explicitly
    3. Update function metadata to force cache invalidation
    4. Multiple schema reload techniques

  ## Expected Result
    - Functions accessible via PostgREST at /rest/v1/rpc/
    - No more 404 errors
*/

-- Verify functions exist (will fail if they don't)
DO $$
DECLARE
  v_func_count integer;
BEGIN
  -- Check get_latest_council_context
  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'get_latest_council_context';

  IF v_func_count = 0 THEN
    RAISE EXCEPTION 'Function get_latest_council_context does not exist';
  END IF;

  RAISE NOTICE 'Found % version(s) of get_latest_council_context', v_func_count;

  -- Check store_council_context
  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'store_council_context';

  IF v_func_count = 0 THEN
    RAISE EXCEPTION 'Function store_council_context does not exist';
  END IF;

  RAISE NOTICE 'Found % version(s) of store_council_context', v_func_count;

  -- Check increment_scout_cycle
  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'increment_scout_cycle';

  IF v_func_count = 0 THEN
    RAISE EXCEPTION 'Function increment_scout_cycle does not exist';
  END IF;

  RAISE NOTICE 'Found % version(s) of increment_scout_cycle', v_func_count;
END $$;

-- Revoke all existing permissions first
REVOKE ALL ON FUNCTION get_latest_council_context(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) FROM PUBLIC;

-- Re-grant permissions explicitly to each role
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) TO anon;
GRANT EXECUTE ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) TO service_role;

GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO anon;
GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO service_role;

-- Update function comments with new timestamp to force metadata change
COMMENT ON FUNCTION get_latest_council_context(uuid, uuid) IS
  'Retrieves latest council context for Alpha Scout - Force reload 2025-12-28 07:00:00 UTC';

COMMENT ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) IS
  'Stores or updates council context after full council meeting - Force reload 2025-12-28 07:00:00 UTC';

COMMENT ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) IS
  'Increments Alpha Scout cycle counter with improvement score - Force reload 2025-12-28 07:00:00 UTC';

-- Force PostgREST schema cache reload using multiple methods
DO $$
BEGIN
  -- Method 1: Direct NOTIFY
  PERFORM pg_notify('pgrst', 'reload schema');
  PERFORM pg_notify('pgrst', 'reload config');

  -- Method 2: Alternative channel name
  NOTIFY pgrst, 'reload schema';
  NOTIFY pgrst, 'reload config';

  RAISE NOTICE '✅ Schema reload notifications sent - PostgREST should refresh within 10 seconds';
END $$;

-- Log success
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Council Context Functions Status:';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ get_latest_council_context(uuid, uuid) - Ready';
  RAISE NOTICE '✅ store_council_context(...) - Ready';
  RAISE NOTICE '✅ increment_scout_cycle(uuid, uuid, numeric) - Ready';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Permissions granted to: anon, authenticated, service_role';
  RAISE NOTICE 'Schema reload requested - allow 10-30 seconds for cache refresh';
  RAISE NOTICE '========================================';
END $$;
