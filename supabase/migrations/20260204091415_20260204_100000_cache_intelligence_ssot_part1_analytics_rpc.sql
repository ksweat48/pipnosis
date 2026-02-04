/*
  # Cache Intelligence System - SSOT Compliance (Part 1: RPC Functions)

  ## Purpose
  Fix analytics RPC functions to read from correct SSOT tables and enable cache intelligence dashboard.

  ## Changes Made

  1. **Fixed RPC: get_freshness_block_stats**
     - Source: Now queries freshness_block_logs (SSOT) instead of cache_stats_log.block_metadata
     - Returns: Block category breakdown with counts and auto-refresh stats
     - Usage: Admin dashboard freshness analytics

  2. **Fixed RPC: get_auto_refresh_stats**
     - Source: Now queries freshness_block_logs for refresh attempts/successes
     - Returns: Auto-refresh performance metrics
     - Usage: Admin dashboard refresh rate calculations

  3. **Fixed RPC: get_symbol_block_breakdown**
     - Source: Now queries freshness_block_logs grouped by symbol
     - Returns: Per-symbol block counts and patterns
     - Usage: Identifying problematic symbols

  4. **Fixed RPC: get_block_trends_hourly**
     - Source: Now queries freshness_block_logs with time bucketing
     - Returns: Time-series block data for trend analysis
     - Usage: Freshness gate trends over time

  ## SSOT Architecture

  - **cache_stats_log**: Event-level cache metrics (hits/misses/writes)
  - **freshness_block_logs**: Event-level freshness block events (new SSOT)
  - **freshness_gate_analytics**: Pre-aggregated daily stats (updated by trigger)

  ## Data Integrity
  - No data migration needed (RPC implementations only)
  - Backward compatible with existing cache_stats_log data
  - Freshness blocks will now flow correctly to dashboard
*/

-- =====================================================================
-- RPC FUNCTION: get_freshness_block_stats
-- =====================================================================
-- Returns block category breakdown with auto-refresh statistics
-- SSOT Source: freshness_block_logs table

DROP FUNCTION IF EXISTS public.get_freshness_block_stats(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_freshness_block_stats(params jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  category text,
  total_blocks bigint,
  refresh_attempts bigint,
  refresh_successes bigint,
  refresh_success_rate numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hours integer := (params->>'p_hours')::integer;
BEGIN
  IF v_hours IS NULL OR v_hours <= 0 THEN
    v_hours := 24;
  END IF;

  RETURN QUERY
  SELECT 
    fbl.category,
    COUNT(*) as total_blocks,
    COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END) as refresh_attempts,
    COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END) as refresh_successes,
    ROUND(
      COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::numeric /
      NULLIF(COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END), 0) * 100, 1
    ) as refresh_success_rate
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (v_hours || ' hours')::interval
  GROUP BY fbl.category
  ORDER BY total_blocks DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_freshness_block_stats(jsonb) TO authenticated, service_role;

-- =====================================================================
-- RPC FUNCTION: get_auto_refresh_stats
-- =====================================================================
-- Returns overall auto-refresh performance metrics
-- SSOT Source: freshness_block_logs table

DROP FUNCTION IF EXISTS public.get_auto_refresh_stats(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_auto_refresh_stats(params jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  total_blocks bigint,
  refresh_attempts bigint,
  refresh_successes bigint,
  refresh_success_rate numeric,
  avg_recovery_time_seconds numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hours integer := (params->>'p_hours')::integer;
BEGIN
  IF v_hours IS NULL OR v_hours <= 0 THEN
    v_hours := 24;
  END IF;

  RETURN QUERY
  SELECT 
    COUNT(*) as total_blocks,
    COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END) as refresh_attempts,
    COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END) as refresh_successes,
    ROUND(
      COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::numeric /
      NULLIF(COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END), 0) * 100, 1
    ) as refresh_success_rate,
    ROUND(
      EXTRACT(EPOCH FROM AVG(
        CASE 
          WHEN fbl.metadata->>'refreshDurationMs' IS NOT NULL 
          THEN ((fbl.metadata->>'refreshDurationMs')::numeric / 1000)::interval
          ELSE NULL 
        END
      ))
    ) as avg_recovery_time_seconds
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (v_hours || ' hours')::interval;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auto_refresh_stats(jsonb) TO authenticated, service_role;

-- =====================================================================
-- RPC FUNCTION: get_symbol_block_breakdown
-- =====================================================================
-- Returns block distribution across symbols
-- SSOT Source: freshness_block_logs table

DROP FUNCTION IF EXISTS public.get_symbol_block_breakdown(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_symbol_block_breakdown(params jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  symbol text,
  total_blocks bigint,
  category_breakdown jsonb,
  total_refresh_attempts bigint,
  total_refresh_successes bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hours integer := (params->>'p_hours')::integer;
BEGIN
  IF v_hours IS NULL OR v_hours <= 0 THEN
    v_hours := 24;
  END IF;

  RETURN QUERY
  SELECT 
    fbl.symbol,
    COUNT(*) as total_blocks,
    jsonb_object_agg(
      fbl.category,
      COUNT(*)
    ) as category_breakdown,
    COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END) as total_refresh_attempts,
    COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END) as total_refresh_successes
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (v_hours || ' hours')::interval
  GROUP BY fbl.symbol
  ORDER BY total_blocks DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_symbol_block_breakdown(jsonb) TO authenticated, service_role;

-- =====================================================================
-- RPC FUNCTION: get_block_trends_hourly
-- =====================================================================
-- Returns time-series block data for trend analysis
-- SSOT Source: freshness_block_logs table

DROP FUNCTION IF EXISTS public.get_block_trends_hourly(jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.get_block_trends_hourly(params jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  hour_bucket timestamp with time zone,
  total_blocks bigint,
  category_distribution jsonb,
  refresh_success_rate numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hours integer := (params->>'p_hours')::integer;
BEGIN
  IF v_hours IS NULL OR v_hours <= 0 THEN
    v_hours := 24;
  END IF;

  RETURN QUERY
  SELECT 
    DATE_TRUNC('hour', fbl.created_at) as hour_bucket,
    COUNT(*) as total_blocks,
    jsonb_object_agg(
      fbl.category,
      COUNT(*)
    ) as category_distribution,
    ROUND(
      COUNT(CASE WHEN fbl.auto_refresh_success THEN 1 END)::numeric /
      NULLIF(COUNT(CASE WHEN fbl.auto_refresh_attempted THEN 1 END), 0) * 100, 1
    ) as refresh_success_rate
  FROM freshness_block_logs fbl
  WHERE fbl.created_at > NOW() - (v_hours || ' hours')::interval
  GROUP BY DATE_TRUNC('hour', fbl.created_at)
  ORDER BY hour_bucket DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_block_trends_hourly(jsonb) TO authenticated, service_role;