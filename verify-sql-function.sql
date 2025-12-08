-- ═══════════════════════════════════════════════════════════════
-- Verify aggregate_candle_from_prices Function
-- ═══════════════════════════════════════════════════════════════
--
-- Run this in Supabase SQL Editor to verify the function exists
-- and is accessible to the service role
--
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Check if function exists
SELECT
  routine_name,
  routine_type,
  data_type,
  security_type
FROM information_schema.routines
WHERE routine_name = 'aggregate_candle_from_prices'
  AND routine_schema = 'public';

-- Expected result: 1 row showing:
-- - routine_name: aggregate_candle_from_prices
-- - routine_type: FUNCTION
-- - data_type: record
-- - security_type: DEFINER

-- Step 2: Check function parameters
SELECT
  parameter_name,
  data_type,
  parameter_mode
FROM information_schema.parameters
WHERE specific_name = (
  SELECT specific_name
  FROM information_schema.routines
  WHERE routine_name = 'aggregate_candle_from_prices'
    AND routine_schema = 'public'
)
ORDER BY ordinal_position;

-- Expected result: 3 rows showing:
-- - p_symbol: text, IN
-- - p_start_time: timestamp with time zone, IN
-- - p_end_time: timestamp with time zone, IN

-- Step 3: Test function execution with sample data
-- This tests if the function can actually run
DO $$
DECLARE
  result RECORD;
BEGIN
  -- Test with a recent time window
  SELECT * INTO result
  FROM aggregate_candle_from_prices(
    'XAUUSD',
    NOW() - INTERVAL '1 hour',
    NOW()
  );

  RAISE NOTICE 'Function executed successfully!';
  RAISE NOTICE 'Price count: %', result.price_count;

  IF result.price_count > 0 THEN
    RAISE NOTICE 'Open: %, High: %, Low: %, Close: %',
      result.first_price, result.high_price, result.low_price, result.last_price;
  ELSE
    RAISE NOTICE 'No prices found in test window (this is OK if no data exists)';
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Function test failed: %', SQLERRM;
END $$;

-- Step 4: Check RLS permissions
-- The function should be accessible to service_role and authenticated
SELECT
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'aggregate_candle_from_prices'
  AND routine_schema = 'public';

-- Expected results should include:
-- - service_role: EXECUTE
-- - authenticated: EXECUTE

-- ═══════════════════════════════════════════════════════════════
-- TROUBLESHOOTING
-- ═══════════════════════════════════════════════════════════════

-- If function doesn't exist, run the migration:
-- supabase/migrations/20251203222928_add_sql_candle_aggregation_function.sql

-- If permissions are missing, run:
-- GRANT EXECUTE ON FUNCTION aggregate_candle_from_prices(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
-- GRANT EXECUTE ON FUNCTION aggregate_candle_from_prices(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
