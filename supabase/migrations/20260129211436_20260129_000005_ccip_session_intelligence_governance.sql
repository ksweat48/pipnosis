/*
  # CCIP: Session Intelligence Data Pipeline - Governance & Schema Fixes

  1. New Tables
    - `trading_watchlist_configuration` - SSOT for which pairs to analyze
    - `session_intelligence_logs` - Diagnostic logging for pipeline health

  2. Security (RLS)
    - Add missing DELETE policy for service_role on session_intelligence_data
    - Add missing UPDATE policy for service_role on session_intelligence_data
    - Create RLS policies for new tables

  3. Diagnostic Functions
    - Create `diagnose_session_intelligence_health()` for pipeline visibility

  4. Indexes
    - Add index on session_intelligence_logs.created_at for performance

  Important Notes:
    - The missing RLS DELETE/UPDATE policies are likely why populate-session-intelligence
      function couldn't clean up old records, causing no new data to be inserted
    - watchlist_configuration centralizes pair selection (SSOT violation fix)
    - Diagnostic function enables root cause analysis without code changes
*/

-- 1. Create SSOT watchlist configuration table
CREATE TABLE IF NOT EXISTS trading_watchlist_configuration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  asset_class text NOT NULL CHECK (asset_class IN ('forex', 'indices', 'commodities', 'crypto')),
  is_active boolean DEFAULT true NOT NULL,
  min_confidence_threshold integer DEFAULT 70 CHECK (min_confidence_threshold BETWEEN 0 AND 100),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on watchlist table
ALTER TABLE trading_watchlist_configuration ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage watchlist
CREATE POLICY "Service role can manage watchlist configuration"
  ON trading_watchlist_configuration FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read watchlist
CREATE POLICY "Authenticated users can read watchlist configuration"
  ON trading_watchlist_configuration FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Populate default watchlist if not already present
INSERT INTO trading_watchlist_configuration (symbol, asset_class) VALUES
  ('XAUUSD', 'commodities'),
  ('US30', 'indices'),
  ('NAS100', 'indices'),
  ('SPX500', 'indices'),
  ('EURUSD', 'forex'),
  ('GBPUSD', 'forex'),
  ('USDJPY', 'forex'),
  ('BTCUSD', 'crypto'),
  ('ETHUSD', 'crypto')
ON CONFLICT(symbol) DO UPDATE SET updated_at = now();

-- 2. Create diagnostic logging table
CREATE TABLE IF NOT EXISTS session_intelligence_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL DEFAULT 'populate-session-intelligence',
  status text NOT NULL CHECK (status IN ('started', 'processing', 'success', 'error', 'stale')),
  symbols_attempted integer DEFAULT 0,
  symbols_successful integer DEFAULT 0,
  pair_count integer DEFAULT 0,
  error_message text,
  execution_time_ms integer,
  diagnostics jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create index for fast queries
CREATE INDEX IF NOT EXISTS idx_session_intelligence_logs_created_at 
  ON session_intelligence_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_intelligence_logs_status 
  ON session_intelligence_logs(status, created_at DESC);

-- Enable RLS on logs
ALTER TABLE session_intelligence_logs ENABLE ROW LEVEL SECURITY;

-- Service role can insert/read logs
CREATE POLICY "Service role can manage session intelligence logs"
  ON session_intelligence_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read logs (for debugging)
CREATE POLICY "Authenticated users can read session intelligence logs"
  ON session_intelligence_logs FOR SELECT
  TO authenticated
  USING (true);

-- 3. Add missing RLS policies for session_intelligence_data
-- These are critical - without DELETE policy, function can't clean up old records
DO $$
BEGIN
  DROP POLICY IF EXISTS "Service role can delete session intelligence" ON session_intelligence_data;
  DROP POLICY IF EXISTS "Service role can update session intelligence" ON session_intelligence_data;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE POLICY "Service role can delete session intelligence"
  ON session_intelligence_data FOR DELETE
  TO service_role
  USING (true);

CREATE POLICY "Service role can update session intelligence"
  ON session_intelligence_data FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Create diagnostic health check function
CREATE OR REPLACE FUNCTION diagnose_session_intelligence_health()
RETURNS TABLE (
  check_name text,
  status text,
  details jsonb,
  checked_at timestamptz
) AS $$
BEGIN
  -- Check 1: Recent realtime prices available
  RETURN QUERY SELECT 
    'realtime_prices_freshness'::text,
    CASE 
      WHEN COUNT(*) > 0 AND MIN(created_at) > NOW() - INTERVAL '5 minutes' THEN 'HEALTHY'
      WHEN COUNT(*) > 0 THEN 'STALE'
      ELSE 'NO_DATA'
    END::text,
    jsonb_build_object(
      'record_count', COUNT(*),
      'symbols', COUNT(DISTINCT symbol),
      'oldest_record_age_minutes', EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/60
    )::jsonb,
    NOW()
  FROM realtime_prices
  WHERE created_at > NOW() - INTERVAL '30 minutes';

  -- Check 2: Candle data availability
  RETURN QUERY SELECT 
    'forex_candles_best_availability'::text,
    CASE 
      WHEN COUNT(*) > 100 THEN 'HEALTHY'
      WHEN COUNT(*) > 0 THEN 'LOW'
      ELSE 'NO_DATA'
    END::text,
    jsonb_build_object(
      'record_count', COUNT(*),
      'symbols', COUNT(DISTINCT symbol),
      'oldest_candle_age_hours', EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/3600
    )::jsonb,
    NOW()
  FROM forex_candles_best
  WHERE created_at > NOW() - INTERVAL '24 hours';

  -- Check 3: Session intelligence data freshness
  RETURN QUERY SELECT 
    'session_intelligence_data_freshness'::text,
    CASE 
      WHEN MAX(created_at) > NOW() - INTERVAL '5 minutes' THEN 'CURRENT'
      WHEN MAX(created_at) > NOW() - INTERVAL '30 minutes' THEN 'STALE'
      ELSE 'MISSING'
    END::text,
    jsonb_build_object(
      'record_count', COUNT(*),
      'non_expired_count', COUNT(CASE WHEN expires_at > NOW() THEN 1 END),
      'latest_record_age_minutes', EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/60
    )::jsonb,
    NOW()
  FROM session_intelligence_data;

  -- Check 4: RLS policies verification
  RETURN QUERY SELECT 
    'rls_policies_completeness'::text,
    CASE WHEN COUNT(*) >= 5 THEN 'COMPLETE' ELSE 'INCOMPLETE' END::text,
    jsonb_agg(jsonb_build_object('policy', policy_name))::jsonb,
    NOW()
  FROM pg_policies
  WHERE tablename = 'session_intelligence_data';

  -- Check 5: Function execution health
  RETURN QUERY SELECT 
    'function_execution_health'::text,
    CASE 
      WHEN MAX(CASE WHEN status = 'success' THEN created_at END) > NOW() - INTERVAL '10 minutes' THEN 'HEALTHY'
      WHEN MAX(CASE WHEN status = 'success' THEN created_at END) > NOW() - INTERVAL '30 minutes' THEN 'DEGRADED'
      ELSE 'UNHEALTHY'
    END::text,
    jsonb_build_object(
      'latest_success', MAX(CASE WHEN status = 'success' THEN created_at END),
      'recent_errors', COUNT(CASE WHEN status = 'error' AND created_at > NOW() - INTERVAL '30 minutes' THEN 1 END),
      'execution_avg_ms', ROUND(AVG(execution_time_ms))
    )::jsonb,
    NOW()
  FROM session_intelligence_logs
  WHERE created_at > NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- 5. Grant necessary permissions
GRANT SELECT ON trading_watchlist_configuration TO authenticated;
GRANT INSERT, SELECT ON session_intelligence_logs TO service_role;
GRANT SELECT ON session_intelligence_logs TO authenticated;
GRANT EXECUTE ON FUNCTION diagnose_session_intelligence_health() TO authenticated;
GRANT EXECUTE ON FUNCTION diagnose_session_intelligence_health() TO service_role;
