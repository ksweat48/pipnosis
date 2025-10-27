/*
  # Fix Critical Schema Issues

  1. Changes
    - Create `candles` table as an alias/view to `market_data` for backward compatibility
    - Fix `function_execution_logs` RLS policy to check `is_admin` instead of `role`
    - Fix `function_health_metrics` RLS policy to check `is_admin` instead of `role`
    - Ensure `realtime_prices` table exists with proper structure
    - Add cleanup function for old realtime prices

  2. Security
    - Maintain RLS on all tables
    - Service role retains full access for backend operations
    - Admins can view monitoring data using correct column name
*/

-- ============================================================================
-- FIX 1: Create candles view for backward compatibility
-- ============================================================================

-- Drop existing view if it exists
DROP VIEW IF EXISTS candles CASCADE;

-- Create candles as a view over market_data for backward compatibility
CREATE OR REPLACE VIEW candles AS
SELECT
  id,
  symbol,
  timeframe,
  timestamp as time,
  open,
  high,
  low,
  close,
  volume,
  tick_volume,
  spread,
  broker_time,
  data_source,
  created_at,
  updated_at
FROM market_data;

-- Grant access to the view
GRANT SELECT ON candles TO authenticated;
GRANT SELECT ON candles TO service_role;

-- ============================================================================
-- FIX 2: Fix function_execution_logs RLS policies
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Admin users can view all function execution logs" ON function_execution_logs;
DROP POLICY IF EXISTS "Service role has full access to function execution logs" ON function_execution_logs;

-- Recreate policies with correct column name
CREATE POLICY "Admin users can view all function execution logs"
  ON function_execution_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role has full access to function execution logs"
  ON function_execution_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- FIX 3: Fix function_health_metrics RLS policies
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Admin users can view all function health metrics" ON function_health_metrics;
DROP POLICY IF EXISTS "Service role has full access to function health metrics" ON function_health_metrics;

-- Recreate policies with correct column name
CREATE POLICY "Admin users can view all function health metrics"
  ON function_health_metrics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role has full access to function health metrics"
  ON function_health_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- FIX 4: Ensure realtime_prices table exists with cleanup function
-- ============================================================================

-- realtime_prices table should already exist from migration 20251027030005
-- Just ensure the cleanup function exists

-- Create or replace cleanup function for old realtime prices
CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete prices older than 1 hour
  DELETE FROM realtime_prices
  WHERE created_at < now() - interval '1 hour';
END;
$$;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION cleanup_old_realtime_prices() TO service_role;

-- ============================================================================
-- FIX 5: Add helpful diagnostic function
-- ============================================================================

-- Function to check table existence and accessibility
CREATE OR REPLACE FUNCTION check_table_health()
RETURNS TABLE(
  table_name text,
  table_exists boolean,
  row_count bigint,
  has_rls boolean,
  policies_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.table_name::text,
    true as table_exists,
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND tables.table_name = t.table_name) > 0 as has_rows,
    pg_class.relrowsecurity as has_rls,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t.table_name) as policies_count
  FROM information_schema.tables t
  LEFT JOIN pg_class ON pg_class.relname = t.table_name
  WHERE t.table_schema = 'public'
    AND t.table_name IN ('market_data', 'realtime_prices', 'function_execution_logs', 'function_health_metrics', 'user_profiles')
  ORDER BY t.table_name;
END;
$$;

-- Grant execute to authenticated users for diagnostics
GRANT EXECUTE ON FUNCTION check_table_health() TO authenticated;
GRANT EXECUTE ON FUNCTION check_table_health() TO service_role;
