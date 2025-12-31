/*
  # Add Cache Freshness Circuit Breaker System

  ## Purpose
  Prevent stale intelligence from being used in trade execution by:
  1. Tracking signal_price in cache entries for drift detection
  2. Adding execution_price to entry intents for comparison
  3. Creating price staleness monitoring

  ## Changes
  1. Add signal_price to omega_market_intelligence for drift detection
  2. Add signal_price and execution_price to entry_intents
  3. Add price_at_analysis to alpha_strategic_cache
  4. Create function to detect stale prices in realtime_prices table

  ## Security
  - All modifications preserve existing RLS policies
  - No data loss or breaking changes
*/

-- =====================================================
-- 1. Add signal_price to omega_market_intelligence
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'omega_market_intelligence' AND column_name = 'signal_price'
  ) THEN
    ALTER TABLE omega_market_intelligence ADD COLUMN signal_price numeric(20,8);
    CREATE INDEX IF NOT EXISTS idx_omega_signal_price ON omega_market_intelligence(signal_price);
  END IF;
END $$;

-- =====================================================
-- 2. Add price fields to alpha_strategic_cache
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_strategic_cache' AND column_name = 'price_at_analysis'
  ) THEN
    ALTER TABLE alpha_strategic_cache ADD COLUMN price_at_analysis numeric(20,8);
    CREATE INDEX IF NOT EXISTS idx_alpha_price_analysis ON alpha_strategic_cache(price_at_analysis);
  END IF;
END $$;

-- =====================================================
-- 3. Add signal_price and execution_price to entry_intents
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'signal_price'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN signal_price numeric(20,8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'execution_price'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN execution_price numeric(20,8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'price_drift_pips'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN price_drift_pips numeric(10,2);
  END IF;
END $$;

-- =====================================================
-- 4. Function to detect stale realtime prices
-- =====================================================
CREATE OR REPLACE FUNCTION check_realtime_price_staleness(
  p_max_age_seconds integer DEFAULT 120
)
RETURNS TABLE (
  symbol text,
  age_seconds integer,
  is_stale boolean,
  received_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rp.symbol,
    EXTRACT(EPOCH FROM (now() - rp.received_at))::integer as age_seconds,
    EXTRACT(EPOCH FROM (now() - rp.received_at))::integer > p_max_age_seconds as is_stale,
    rp.received_at
  FROM realtime_prices rp
  ORDER BY rp.received_at DESC;
END;
$$;

-- =====================================================
-- 5. Function to get cache freshness statistics
-- =====================================================
CREATE OR REPLACE FUNCTION get_cache_freshness_stats()
RETURNS TABLE (
  cache_tier text,
  total_entries bigint,
  expired_entries bigint,
  avg_age_seconds numeric,
  max_age_seconds integer,
  oldest_entry_age_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    'omega' as cache_tier,
    COUNT(*)::bigint as total_entries,
    COUNT(*) FILTER (WHERE expires_at < now())::bigint as expired_entries,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))), 2) as avg_age_seconds,
    900 as max_age_seconds,
    MAX(EXTRACT(EPOCH FROM (now() - created_at)))::integer as oldest_entry_age_seconds
  FROM omega_market_intelligence

  UNION ALL

  SELECT
    'alpha' as cache_tier,
    COUNT(*)::bigint as total_entries,
    COUNT(*) FILTER (WHERE expires_at < now())::bigint as expired_entries,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))), 2) as avg_age_seconds,
    540 as max_age_seconds,
    MAX(EXTRACT(EPOCH FROM (now() - created_at)))::integer as oldest_entry_age_seconds
  FROM alpha_strategic_cache

  UNION ALL

  SELECT
    'scout' as cache_tier,
    COUNT(*)::bigint as total_entries,
    COUNT(*) FILTER (WHERE expires_at < now())::bigint as expired_entries,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))), 2) as avg_age_seconds,
    60 as max_age_seconds,
    MAX(EXTRACT(EPOCH FROM (now() - created_at)))::integer as oldest_entry_age_seconds
  FROM scout_market_state;
END;
$$;

-- =====================================================
-- 6. Automatic cleanup of stale cache entries (scheduled)
-- =====================================================
CREATE OR REPLACE FUNCTION auto_cleanup_stale_cache()
RETURNS TABLE (
  cache_tier text,
  deleted_count bigint,
  cleaned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_omega_deleted bigint;
  v_alpha_deleted bigint;
  v_scout_deleted bigint;
  v_cleanup_time timestamptz;
BEGIN
  v_cleanup_time := now();

  DELETE FROM omega_market_intelligence WHERE expires_at < v_cleanup_time;
  GET DIAGNOSTICS v_omega_deleted = ROW_COUNT;

  DELETE FROM alpha_strategic_cache WHERE expires_at < v_cleanup_time;
  GET DIAGNOSTICS v_alpha_deleted = ROW_COUNT;

  DELETE FROM scout_market_state WHERE expires_at < v_cleanup_time;
  GET DIAGNOSTICS v_scout_deleted = ROW_COUNT;

  DELETE FROM cache_stats_log WHERE created_at < v_cleanup_time - interval '7 days';

  RETURN QUERY
  SELECT 'omega'::text, v_omega_deleted, v_cleanup_time
  UNION ALL
  SELECT 'alpha'::text, v_alpha_deleted, v_cleanup_time
  UNION ALL
  SELECT 'scout'::text, v_scout_deleted, v_cleanup_time;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_realtime_price_staleness TO authenticated;
GRANT EXECUTE ON FUNCTION get_cache_freshness_stats TO authenticated;
GRANT EXECUTE ON FUNCTION auto_cleanup_stale_cache TO service_role;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_omega_created_at ON omega_market_intelligence(created_at);
CREATE INDEX IF NOT EXISTS idx_alpha_created_at ON alpha_strategic_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_scout_created_at ON scout_market_state(created_at);
CREATE INDEX IF NOT EXISTS idx_realtime_prices_received_at ON realtime_prices(received_at);
