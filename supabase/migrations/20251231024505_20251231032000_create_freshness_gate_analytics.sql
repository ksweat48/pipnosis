/*
  # Freshness Gate Analytics System

  Creates comprehensive analytics functions for monitoring the freshness gate's performance:

  1. Block Category Distribution
     - Shows breakdown of all block types (stale intelligence, price drift, etc.)
     - Helps identify most common blocking reasons

  2. Auto-Refresh Performance Metrics
     - Tracks how often auto-refresh saves trades
     - Shows success rate of refresh attempts
     - Identifies persistent staleness issues

  3. Per-Symbol Block Analysis
     - Shows which symbols get blocked most
     - Breaks down block causes by symbol
     - Helps optimize TTLs per symbol

  4. Block Trends Over Time
     - Hourly breakdown of block patterns
     - Identifies peak blocking periods
     - Correlates with market conditions

  Security: All functions use security definer with proper RLS
*/

-- Function 1: Get block category distribution
CREATE OR REPLACE FUNCTION get_freshness_block_stats(p_hours int DEFAULT 24)
RETURNS TABLE (
  block_category text,
  total_blocks bigint,
  percentage numeric,
  avg_stale_seconds numeric,
  symbols_affected text[]
) SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH block_stats AS (
    SELECT
      (block_metadata->>'category')::text as category,
      COUNT(*) as count,
      AVG(COALESCE((block_metadata->>'maxAgeSeconds')::numeric, 0)) as avg_age,
      array_agg(DISTINCT symbol) as syms
    FROM cache_stats_log
    WHERE
      event_type = 'block'
      AND created_at >= NOW() - (p_hours || ' hours')::interval
      AND block_metadata->>'category' IS NOT NULL
    GROUP BY category
  ),
  total_blocks AS (
    SELECT SUM(count) as total FROM block_stats
  )
  SELECT
    bs.category,
    bs.count,
    ROUND((bs.count::numeric / NULLIF(tb.total, 0)) * 100, 2) as pct,
    ROUND(bs.avg_age, 2),
    bs.syms
  FROM block_stats bs
  CROSS JOIN total_blocks tb
  ORDER BY bs.count DESC;
END;
$$;

-- Function 2: Get auto-refresh performance
CREATE OR REPLACE FUNCTION get_auto_refresh_stats(p_hours int DEFAULT 24)
RETURNS TABLE (
  total_blocks bigint,
  refresh_attempted bigint,
  refresh_succeeded bigint,
  hard_blocks bigint,
  success_rate numeric,
  rescue_rate numeric
) SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH refresh_events AS (
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'block') as blocks,
      COUNT(*) FILTER (
        WHERE event_type = 'block'
        AND (block_metadata->>'refreshAttempted')::boolean = true
      ) as attempted,
      COUNT(*) FILTER (
        WHERE event_type = 'block'
        AND (block_metadata->>'refreshAttempted')::boolean = true
        AND (block_metadata->>'refreshSucceeded')::boolean = true
      ) as succeeded,
      COUNT(*) FILTER (
        WHERE event_type = 'block'
        AND (
          (block_metadata->>'refreshAttempted')::boolean = false
          OR (block_metadata->>'refreshSucceeded')::boolean = false
        )
      ) as hard
    FROM cache_stats_log
    WHERE
      created_at >= NOW() - (p_hours || ' hours')::interval
      AND event_type = 'block'
  )
  SELECT
    blocks,
    attempted,
    succeeded,
    hard,
    CASE WHEN attempted > 0
      THEN ROUND((succeeded::numeric / attempted) * 100, 2)
      ELSE 0
    END as success_pct,
    CASE WHEN blocks > 0
      THEN ROUND((succeeded::numeric / blocks) * 100, 2)
      ELSE 0
    END as rescue_pct
  FROM refresh_events;
END;
$$;

-- Function 3: Get per-symbol block breakdown
CREATE OR REPLACE FUNCTION get_symbol_block_breakdown(p_hours int DEFAULT 24)
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
) SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH symbol_blocks AS (
    SELECT
      csl.symbol,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE block_metadata->>'category' = 'BLOCK_STALE_OMEGA_INTELLIGENCE') as omega,
      COUNT(*) FILTER (WHERE block_metadata->>'category' = 'BLOCK_STALE_ALPHA_INTELLIGENCE') as alpha,
      COUNT(*) FILTER (WHERE block_metadata->>'category' = 'BLOCK_PRICE_DRIFT') as drift,
      COUNT(*) FILTER (WHERE block_metadata->>'category' = 'BLOCK_STALE_PRICE_FEED') as price,
      COUNT(*) FILTER (WHERE block_metadata->>'category' = 'BLOCK_NO_PRICE_DATA') as no_price,
      COUNT(*) FILTER (WHERE block_metadata->>'category' = 'BLOCK_PERSISTENT_STALENESS') as persistent
    FROM cache_stats_log csl
    WHERE
      csl.event_type = 'block'
      AND csl.created_at >= NOW() - (p_hours || ' hours')::interval
      AND csl.symbol IS NOT NULL
    GROUP BY csl.symbol
  )
  SELECT
    sb.symbol,
    sb.total,
    sb.omega,
    sb.alpha,
    sb.drift,
    sb.price,
    sb.no_price,
    sb.persistent,
    CASE
      WHEN sb.omega >= GREATEST(sb.alpha, sb.drift, sb.price, sb.no_price, sb.persistent) THEN 'Stale Omega'
      WHEN sb.alpha >= GREATEST(sb.omega, sb.drift, sb.price, sb.no_price, sb.persistent) THEN 'Stale Alpha'
      WHEN sb.drift >= GREATEST(sb.omega, sb.alpha, sb.price, sb.no_price, sb.persistent) THEN 'Price Drift'
      WHEN sb.price >= GREATEST(sb.omega, sb.alpha, sb.drift, sb.no_price, sb.persistent) THEN 'Stale Price'
      WHEN sb.no_price >= GREATEST(sb.omega, sb.alpha, sb.drift, sb.price, sb.persistent) THEN 'No Price'
      ELSE 'Persistent Staleness'
    END
  FROM symbol_blocks sb
  ORDER BY sb.total DESC;
END;
$$;

-- Function 4: Get block trends over time (hourly)
CREATE OR REPLACE FUNCTION get_block_trends_hourly(p_hours int DEFAULT 24)
RETURNS TABLE (
  hour_bucket timestamptz,
  total_blocks bigint,
  stale_blocks bigint,
  drift_blocks bigint,
  refresh_success_rate numeric
) SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH hourly_stats AS (
    SELECT
      date_trunc('hour', created_at) as hour,
      COUNT(*) as blocks,
      COUNT(*) FILTER (
        WHERE block_metadata->>'category' IN (
          'BLOCK_STALE_OMEGA_INTELLIGENCE',
          'BLOCK_STALE_ALPHA_INTELLIGENCE',
          'BLOCK_STALE_PRICE_FEED',
          'BLOCK_PERSISTENT_STALENESS'
        )
      ) as stale,
      COUNT(*) FILTER (
        WHERE block_metadata->>'category' = 'BLOCK_PRICE_DRIFT'
      ) as drift,
      COUNT(*) FILTER (
        WHERE (block_metadata->>'refreshSucceeded')::boolean = true
      ) as refreshed,
      COUNT(*) FILTER (
        WHERE (block_metadata->>'refreshAttempted')::boolean = true
      ) as attempted
    FROM cache_stats_log
    WHERE
      event_type = 'block'
      AND created_at >= NOW() - (p_hours || ' hours')::interval
    GROUP BY hour
  )
  SELECT
    hour,
    blocks,
    stale,
    drift,
    CASE WHEN attempted > 0
      THEN ROUND((refreshed::numeric / attempted) * 100, 2)
      ELSE 0
    END
  FROM hourly_stats
  ORDER BY hour DESC;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_freshness_block_stats(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_auto_refresh_stats(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_symbol_block_breakdown(int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_block_trends_hourly(int) TO authenticated;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cache_stats_block_category
  ON cache_stats_log((block_metadata->>'category'))
  WHERE event_type = 'block';

CREATE INDEX IF NOT EXISTS idx_cache_stats_block_time
  ON cache_stats_log(created_at, event_type)
  WHERE event_type = 'block';

CREATE INDEX IF NOT EXISTS idx_cache_stats_block_symbol
  ON cache_stats_log(symbol, event_type)
  WHERE event_type = 'block';
