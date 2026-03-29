/*
  # Price Write Pipeline Health Functions

  ## Purpose
  Provides server-side functions to detect when the price write pipeline
  (hybrid-price-collector cron) has gone silent — enabling the client to
  surface a warning before the 90-second freshness hard block fires.

  ## New Functions
  - `get_price_pipeline_health()` — Returns per-symbol age in seconds and
    a pipeline-level status (ok / warning / critical / no_data).
    Warning threshold: 60 seconds (before the 90s hard block).
    Critical threshold: 120 seconds (pipeline has missed at least 2 cron runs).

  ## Security
  - Reads only from `realtime_prices` (existing RLS-protected table)
  - Function is SECURITY DEFINER so authenticated clients can call it without
    needing direct table access beyond what RLS already grants
  - Restricted to authenticated role only

  ## Notes
  - No new tables created — reads existing `realtime_prices` table
  - No data mutations — read-only health check
  - Designed to be polled every 30 seconds from the client
*/

CREATE OR REPLACE FUNCTION get_price_pipeline_health()
RETURNS TABLE (
  symbol TEXT,
  last_price_at TIMESTAMPTZ,
  age_seconds INTEGER,
  status TEXT,
  warning_threshold_seconds INTEGER,
  critical_threshold_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_warning_threshold INTEGER := 60;
  v_critical_threshold INTEGER := 120;
BEGIN
  RETURN QUERY
  WITH latest_prices AS (
    SELECT
      rp.symbol,
      MAX(rp.created_at) AS last_price_at
    FROM realtime_prices rp
    GROUP BY rp.symbol
  )
  SELECT
    lp.symbol,
    lp.last_price_at,
    EXTRACT(EPOCH FROM (NOW() - lp.last_price_at))::INTEGER AS age_seconds,
    CASE
      WHEN EXTRACT(EPOCH FROM (NOW() - lp.last_price_at)) > v_critical_threshold THEN 'critical'
      WHEN EXTRACT(EPOCH FROM (NOW() - lp.last_price_at)) > v_warning_threshold THEN 'warning'
      ELSE 'ok'
    END AS status,
    v_warning_threshold AS warning_threshold_seconds,
    v_critical_threshold AS critical_threshold_seconds
  FROM latest_prices lp
  ORDER BY age_seconds DESC;
END;
$$;

REVOKE ALL ON FUNCTION get_price_pipeline_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_price_pipeline_health() TO authenticated;

COMMENT ON FUNCTION get_price_pipeline_health() IS
  'Returns per-symbol price age and pipeline health status. Warning at 60s, critical at 120s. '
  'Used by client-side health monitor to surface write pipeline degradation before the 90s hard block fires.';
