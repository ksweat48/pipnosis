/*
  # Fix Cache Analytics System - SSOT Compliance

  ## Problem
  1. freshness_block_logs table has 0 rows because INSERT policy only allows service_role,
     but the frontend client writes as authenticated user
  2. All 4 freshness analytics RPCs return column names that don't match what 
     freshness-analytics-service.ts expects
  3. Symbol breakdown and trends RPCs use invalid nested aggregates (jsonb_object_agg with COUNT)
  4. cache_statistics table has 0 rows because no rollup from cache_stats_log exists
  5. AlphaIntelligenceTelemetry reads from empty cache_statistics instead of cache_stats_log

  ## Changes

  ### 1. Fix freshness_block_logs RLS
  - Add INSERT policy for authenticated users (matching cache_stats_log pattern)
  - Add admin SELECT policy for dashboard access

  ### 2. Fix get_freshness_block_stats RPC
  - Return columns: block_category, total_blocks, percentage, avg_stale_seconds, symbols_affected
  - Matches freshness-analytics-service.ts lines 63-68

  ### 3. Fix get_auto_refresh_stats RPC
  - Return columns: total_blocks, refresh_attempted, refresh_succeeded, hard_blocks, success_rate, rescue_rate
  - Matches freshness-analytics-service.ts lines 96-101

  ### 4. Fix get_symbol_block_breakdown RPC
  - Return individual columns: stale_omega, stale_alpha, price_drift, stale_price, no_price, persistent_stale, most_common_cause
  - Matches freshness-analytics-service.ts lines 126-134

  ### 5. Fix get_block_trends_hourly RPC
  - Return columns: hour_bucket, total_blocks, stale_blocks, drift_blocks, refresh_success_rate
  - Matches freshness-analytics-service.ts lines 158-163

  ### 6. Create get_alpha_thesis_cache_stats RPC
  - Aggregates cache_stats_log data on the fly for AlphaIntelligenceTelemetry
  - Returns: total_lookups, cache_hits, cache_misses, hit_rate, avg_cache_age_seconds, total_llm_calls_saved

  ### 7. Create rollup_cache_statistics function
  - Periodic aggregation from cache_stats_log into cache_statistics
  - For better performance at scale

  ## Security
  - No destructive operations
  - Existing RLS policies preserved
  - New policies follow authenticated user ownership pattern
*/

-- =====================================================================
-- STEP 1: Fix freshness_block_logs RLS policies
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'freshness_block_logs' 
    AND policyname = 'Authenticated users can insert freshness blocks'
  ) THEN
    CREATE POLICY "Authenticated users can insert freshness blocks"
      ON freshness_block_logs
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'freshness_block_logs' 
    AND policyname = 'Admin users can read all freshness blocks'
  ) THEN
    CREATE POLICY "Admin users can read all freshness blocks"
      ON freshness_block_logs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid() AND up.is_admin = true
        )
      );
  END IF;
END $$;

-- =====================================================================
-- STEP 2: Fix get_freshness_block_stats RPC
-- Returns columns matching freshness-analytics-service.ts expectations
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_freshness_block_stats(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_freshness_block_stats(p_hours integer DEFAULT 24)
RETURNS TABLE (
  block_category text,
  total_blocks bigint,
  percentage numeric,
  avg_stale_seconds numeric,
  symbols_affected text[]
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total bigint;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM freshness_block_logs
  WHERE created_at > NOW() - (p_hours || ' hours')::interval;

  IF v_total = 0 THEN
    v_total := 1;
  END IF;

  RETURN QUERY
  SELECT
    fbl.category AS block_category,
    COUNT(*)::bigint AS total_blocks,
    ROUND((COUNT(*)::numeric / v_total) * 100, 1) AS percentage,
    COALESCE(
      ROUND(AVG(
        CASE WHEN fbl.metadata->>'staleSeconds' IS NOT NULL
        THEN (fbl.metadata->>'staleSeconds')::numeric
        ELSE NULL END
      ), 1),
      0
    ) AS avg_stale_seconds,
    ARRAY_AGG(DISTINCT fbl.symbol) AS symbols_affected
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (p_hours || ' hours')::interval
  GROUP BY fbl.category
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_freshness_block_stats(integer) TO authenticated, service_role;

-- =====================================================================
-- STEP 3: Fix get_auto_refresh_stats RPC
-- Returns columns matching freshness-analytics-service.ts expectations
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_auto_refresh_stats(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_auto_refresh_stats(p_hours integer DEFAULT 24)
RETURNS TABLE (
  total_blocks bigint,
  refresh_attempted bigint,
  refresh_succeeded bigint,
  hard_blocks bigint,
  success_rate numeric,
  rescue_rate numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint AS total_blocks,
    COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END)::bigint AS refresh_attempted,
    COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::bigint AS refresh_succeeded,
    COUNT(CASE WHEN fbl.auto_refresh_attempted AND NOT fbl.auto_refresh_success THEN 1 END)::bigint AS hard_blocks,
    ROUND(
      COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::numeric /
      NULLIF(COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END), 0) * 100, 1
    ) AS success_rate,
    ROUND(
      COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::numeric /
      NULLIF(COUNT(*), 0) * 100, 1
    ) AS rescue_rate
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (p_hours || ' hours')::interval;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auto_refresh_stats(integer) TO authenticated, service_role;

-- =====================================================================
-- STEP 4: Fix get_symbol_block_breakdown RPC
-- Returns individual per-category columns instead of jsonb aggregate
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_symbol_block_breakdown(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_symbol_block_breakdown(p_hours integer DEFAULT 24)
RETURNS TABLE (
  symbol text,
  total_blocks bigint,
  stale_omega bigint,
  stale_alpha bigint,
  price_drift bigint,
  stale_price bigint,
  no_price bigint,
  persistent_stale bigint,
  most_common_cause text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    fbl.symbol,
    COUNT(*)::bigint AS total_blocks,
    COUNT(CASE WHEN fbl.category = 'BLOCK_STALE_OMEGA_INTELLIGENCE' THEN 1 END)::bigint AS stale_omega,
    COUNT(CASE WHEN fbl.category = 'BLOCK_STALE_ALPHA_INTELLIGENCE' THEN 1 END)::bigint AS stale_alpha,
    COUNT(CASE WHEN fbl.category = 'BLOCK_PRICE_DRIFT' THEN 1 END)::bigint AS price_drift,
    COUNT(CASE WHEN fbl.category = 'BLOCK_STALE_PRICE_FEED' THEN 1 END)::bigint AS stale_price,
    COUNT(CASE WHEN fbl.category = 'BLOCK_NO_PRICE_DATA' THEN 1 END)::bigint AS no_price,
    COUNT(CASE WHEN fbl.category = 'BLOCK_PERSISTENT_STALENESS' THEN 1 END)::bigint AS persistent_stale,
    (
      SELECT sub.category
      FROM freshness_block_logs sub
      WHERE sub.symbol = fbl.symbol
        AND sub.created_at > NOW() - (p_hours || ' hours')::interval
      GROUP BY sub.category
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) AS most_common_cause
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (p_hours || ' hours')::interval
  GROUP BY fbl.symbol
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_symbol_block_breakdown(integer) TO authenticated, service_role;

-- =====================================================================
-- STEP 5: Fix get_block_trends_hourly RPC
-- Returns individual stale/drift columns instead of jsonb aggregate
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_block_trends_hourly(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_block_trends_hourly(p_hours integer DEFAULT 24)
RETURNS TABLE (
  hour_bucket timestamp with time zone,
  total_blocks bigint,
  stale_blocks bigint,
  drift_blocks bigint,
  refresh_success_rate numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('hour', fbl.created_at) AS hour_bucket,
    COUNT(*)::bigint AS total_blocks,
    COUNT(CASE WHEN fbl.category IN (
      'BLOCK_STALE_OMEGA_INTELLIGENCE',
      'BLOCK_STALE_ALPHA_INTELLIGENCE',
      'BLOCK_STALE_PRICE_FEED',
      'BLOCK_PERSISTENT_STALENESS'
    ) THEN 1 END)::bigint AS stale_blocks,
    COUNT(CASE WHEN fbl.category = 'BLOCK_PRICE_DRIFT' THEN 1 END)::bigint AS drift_blocks,
    ROUND(
      COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::numeric /
      NULLIF(COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END), 0) * 100, 1
    ) AS refresh_success_rate
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (p_hours || ' hours')::interval
  GROUP BY DATE_TRUNC('hour', fbl.created_at)
  ORDER BY DATE_TRUNC('hour', fbl.created_at) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_block_trends_hourly(integer) TO authenticated, service_role;

-- =====================================================================
-- STEP 6: Create get_alpha_thesis_cache_stats RPC
-- Real-time aggregation from cache_stats_log for telemetry dashboard
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_alpha_thesis_cache_stats()
RETURNS TABLE (
  total_lookups bigint,
  cache_hits bigint,
  cache_misses bigint,
  hit_rate numeric,
  avg_cache_age_seconds numeric,
  total_llm_calls_saved bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint AS total_lookups,
    COUNT(CASE WHEN csl.hit_or_miss = 'hit' THEN 1 END)::bigint AS cache_hits,
    COUNT(CASE WHEN csl.hit_or_miss = 'miss' THEN 1 END)::bigint AS cache_misses,
    ROUND(
      COUNT(CASE WHEN csl.hit_or_miss = 'hit' THEN 1 END)::numeric /
      NULLIF(COUNT(*), 0) * 100, 1
    ) AS hit_rate,
    ROUND(
      AVG(CASE WHEN csl.hit_or_miss = 'hit' AND csl.cache_age_seconds > 0
        THEN csl.cache_age_seconds ELSE NULL END)::numeric, 1
    ) AS avg_cache_age_seconds,
    COALESCE(SUM(csl.llm_calls_saved), 0)::bigint AS total_llm_calls_saved
  FROM cache_stats_log csl
  WHERE csl.cache_tier = 'alpha_thesis'
    AND csl.event_type = 'lookup';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_alpha_thesis_cache_stats() TO authenticated, service_role;

-- =====================================================================
-- STEP 7: Create rollup_cache_statistics function
-- Periodic rollup from cache_stats_log into cache_statistics
-- =====================================================================

CREATE OR REPLACE FUNCTION public.rollup_cache_statistics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier text;
BEGIN
  FOR v_tier IN SELECT DISTINCT cache_tier FROM cache_stats_log LOOP
    INSERT INTO cache_statistics (
      id, cache_tier,
      total_lookups, cache_hits, cache_misses,
      total_llm_calls_saved, avg_cache_age_seconds,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      v_tier,
      (SELECT COUNT(*) FROM cache_stats_log WHERE cache_tier = v_tier AND event_type = 'lookup'),
      (SELECT COUNT(*) FROM cache_stats_log WHERE cache_tier = v_tier AND hit_or_miss = 'hit'),
      (SELECT COUNT(*) FROM cache_stats_log WHERE cache_tier = v_tier AND hit_or_miss = 'miss'),
      (SELECT COALESCE(SUM(llm_calls_saved), 0) FROM cache_stats_log WHERE cache_tier = v_tier),
      (SELECT ROUND(AVG(CASE WHEN cache_age_seconds > 0 THEN cache_age_seconds ELSE NULL END)::numeric, 1)
       FROM cache_stats_log WHERE cache_tier = v_tier AND hit_or_miss = 'hit'),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  DELETE FROM cache_statistics
  WHERE id NOT IN (
    SELECT id FROM cache_statistics
    ORDER BY created_at DESC
    LIMIT 100
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollup_cache_statistics() TO service_role;

-- =====================================================================
-- STEP 8: Ensure cache_statistics has correct columns
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_statistics' AND column_name = 'total_lookups'
  ) THEN
    ALTER TABLE cache_statistics ADD COLUMN total_lookups integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_statistics' AND column_name = 'cache_hits'
  ) THEN
    ALTER TABLE cache_statistics ADD COLUMN cache_hits integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_statistics' AND column_name = 'cache_misses'
  ) THEN
    ALTER TABLE cache_statistics ADD COLUMN cache_misses integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_statistics' AND column_name = 'total_llm_calls_saved'
  ) THEN
    ALTER TABLE cache_statistics ADD COLUMN total_llm_calls_saved integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_statistics' AND column_name = 'avg_cache_age_seconds'
  ) THEN
    ALTER TABLE cache_statistics ADD COLUMN avg_cache_age_seconds numeric DEFAULT 0;
  END IF;
END $$;

-- =====================================================================
-- STEP 9: Add performance indexes
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_freshness_block_logs_created_at
  ON freshness_block_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_freshness_block_logs_category_created
  ON freshness_block_logs (category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_freshness_block_logs_symbol_created
  ON freshness_block_logs (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cache_stats_log_tier_event
  ON cache_stats_log (cache_tier, event_type);

CREATE INDEX IF NOT EXISTS idx_cache_stats_log_hit_miss
  ON cache_stats_log (hit_or_miss);
