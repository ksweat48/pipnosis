/*
  # Create Autonomous System Monitoring Views

  1. Purpose
    - Provide comprehensive monitoring views for autonomous trading system
    - Track cron job health, price polling metrics, and candle generation stats
    - Enable real-time system health monitoring from the frontend

  2. New Views
    - `v_autonomous_system_dashboard` - Complete system status snapshot
    - `v_cron_job_execution_history` - Recent cron job execution details
    - `v_price_polling_metrics` - Price polling performance metrics
    - `v_candle_generation_metrics` - Candle creation statistics

  3. Helper Functions
    - `get_system_uptime_percentage()` - Calculate system uptime over last 24h
    - `get_polling_success_rate()` - Calculate price polling success rate

  4. Security
    - All views and functions accessible to authenticated users
    - Read-only access to monitoring data
*/

-- Helper function to calculate system uptime percentage
CREATE OR REPLACE FUNCTION get_system_uptime_percentage()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_polls bigint;
  successful_polls bigint;
  uptime_pct numeric;
BEGIN
  -- Count polls in last 24 hours
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE error_message IS NULL)
  INTO total_polls, successful_polls
  FROM price_polling_health
  WHERE poll_timestamp > now() - interval '24 hours';
  
  IF total_polls = 0 THEN
    RETURN 0;
  END IF;
  
  uptime_pct := (successful_polls::numeric / total_polls::numeric) * 100;
  RETURN ROUND(uptime_pct, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION get_system_uptime_percentage() TO authenticated;

-- Helper function to get polling success rate for specific time window
CREATE OR REPLACE FUNCTION get_polling_success_rate(time_window interval DEFAULT interval '1 hour')
RETURNS TABLE(
  total_polls bigint,
  successful_polls bigint,
  failed_polls bigint,
  success_rate numeric,
  avg_duration_ms numeric,
  last_poll_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint as total_polls,
    COUNT(*) FILTER (WHERE error_message IS NULL)::bigint as successful_polls,
    COUNT(*) FILTER (WHERE error_message IS NOT NULL)::bigint as failed_polls,
    ROUND(
      (COUNT(*) FILTER (WHERE error_message IS NULL)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100,
      2
    ) as success_rate,
    ROUND(AVG(total_duration_ms), 2) as avg_duration_ms,
    MAX(poll_timestamp) as last_poll_time
  FROM price_polling_health
  WHERE poll_timestamp > now() - time_window;
END;
$$;

GRANT EXECUTE ON FUNCTION get_polling_success_rate(interval) TO authenticated;

-- View: Cron job execution history with performance metrics
CREATE OR REPLACE VIEW v_cron_job_execution_history AS
SELECT 
  j.jobname,
  j.schedule,
  j.active,
  jrd.start_time,
  jrd.end_time,
  jrd.status,
  jrd.return_message,
  ROUND(EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time)) * 1000, 2) as duration_ms
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jrd.start_time > now() - interval '24 hours'
  AND (j.jobname LIKE '%price%' OR j.jobname LIKE '%candle%' OR j.jobname LIKE '%finalize%')
ORDER BY jrd.start_time DESC;

GRANT SELECT ON v_cron_job_execution_history TO authenticated;

-- View: Price polling performance metrics
CREATE OR REPLACE VIEW v_price_polling_metrics AS
SELECT 
  date_trunc('minute', poll_timestamp) as poll_minute,
  COUNT(*) as poll_count,
  COUNT(*) FILTER (WHERE error_message IS NULL) as successful_polls,
  COUNT(*) FILTER (WHERE error_message IS NOT NULL) as failed_polls,
  ROUND(AVG(total_duration_ms), 2) as avg_duration_ms,
  ROUND(AVG(successful_pairs), 0) as avg_successful_pairs,
  ROUND(AVG(failed_pairs), 0) as avg_failed_pairs,
  MAX(poll_timestamp) as latest_poll
FROM price_polling_health
WHERE poll_timestamp > now() - interval '24 hours'
GROUP BY date_trunc('minute', poll_timestamp)
ORDER BY poll_minute DESC;

GRANT SELECT ON v_price_polling_metrics TO authenticated;

-- View: Candle generation metrics by timeframe
CREATE OR REPLACE VIEW v_candle_generation_metrics AS
SELECT 
  timeframe,
  COUNT(DISTINCT symbol) as symbols_tracked,
  COUNT(*) as active_candles,
  SUM(tick_count) as total_ticks,
  ROUND(AVG(tick_count), 0) as avg_ticks_per_candle,
  MAX(last_updated) as most_recent_update,
  ROUND(EXTRACT(EPOCH FROM (now() - MAX(last_updated))), 0) as seconds_since_update,
  CASE 
    WHEN MAX(last_updated) > now() - interval '2 minutes' THEN 'active'
    WHEN MAX(last_updated) > now() - interval '10 minutes' THEN 'stale'
    ELSE 'inactive'
  END as status
FROM candle_state
WHERE is_complete = false
GROUP BY timeframe
ORDER BY 
  CASE timeframe
    WHEN 'M1' THEN 1
    WHEN 'M5' THEN 2
    WHEN 'M15' THEN 3
    WHEN 'M30' THEN 4
    WHEN 'H1' THEN 5
    WHEN 'H4' THEN 6
    WHEN 'D1' THEN 7
    WHEN 'W1' THEN 8
  END;

GRANT SELECT ON v_candle_generation_metrics TO authenticated;

-- View: Comprehensive autonomous system dashboard
CREATE OR REPLACE VIEW v_autonomous_system_dashboard AS
SELECT 
  now() as timestamp,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', jobname,
        'schedule', schedule,
        'active', active
      )
    )
    FROM cron.job
    WHERE jobname LIKE '%price%' OR jobname LIKE '%candle%' OR jobname LIKE '%finalize%'
  ) as active_cron_jobs,
  (
    SELECT COUNT(*)
    FROM cron.job_run_details jrd
    JOIN cron.job j ON j.jobid = jrd.jobid
    WHERE jrd.start_time > now() - interval '10 minutes'
      AND jrd.status = 'succeeded'
      AND (j.jobname LIKE '%price%' OR j.jobname LIKE '%candle%')
  ) as successful_executions_last_10min,
  (
    SELECT COUNT(*)
    FROM cron.job_run_details jrd
    JOIN cron.job j ON j.jobid = jrd.jobid
    WHERE jrd.start_time > now() - interval '10 minutes'
      AND jrd.status = 'failed'
      AND (j.jobname LIKE '%price%' OR j.jobname LIKE '%candle%')
  ) as failed_executions_last_10min,
  (
    SELECT jsonb_build_object(
      'total_polls', total_polls,
      'successful_polls', successful_polls,
      'failed_polls', failed_polls,
      'success_rate', success_rate,
      'avg_duration_ms', avg_duration_ms,
      'last_poll_time', last_poll_time,
      'seconds_since_last_poll', ROUND(EXTRACT(EPOCH FROM (now() - last_poll_time)), 0)
    )
    FROM get_polling_success_rate(interval '1 hour')
  ) as price_polling_stats,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'symbol', symbol,
        'status', status,
        'seconds_since_last_price', seconds_since_last_price
      )
    )
    FROM check_price_data_freshness()
  ) as price_data_freshness,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'timeframe', timeframe,
        'active_candles', active_candles,
        'total_ticks', total_ticks,
        'status', status,
        'seconds_since_update', seconds_since_update
      )
    )
    FROM v_candle_generation_metrics
  ) as candle_generation_stats,
  get_system_uptime_percentage() as system_uptime_24h,
  get_candle_system_health() as overall_health,
  CASE 
    WHEN get_system_uptime_percentage() >= 95 THEN 'healthy'
    WHEN get_system_uptime_percentage() >= 80 THEN 'degraded'
    ELSE 'unhealthy'
  END as system_status;

GRANT SELECT ON v_autonomous_system_dashboard TO authenticated;

-- View: Recent errors and alerts
CREATE OR REPLACE VIEW v_system_alerts AS
SELECT 
  'price_polling_error' as alert_type,
  poll_timestamp as alert_time,
  'Price polling failed' as alert_title,
  error_message as alert_message,
  'warning' as severity
FROM price_polling_health
WHERE error_message IS NOT NULL
  AND poll_timestamp > now() - interval '1 hour'
UNION ALL
SELECT 
  'cron_job_failure' as alert_type,
  jrd.start_time as alert_time,
  'Cron job failed: ' || j.jobname as alert_title,
  jrd.return_message as alert_message,
  'error' as severity
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE jrd.status = 'failed'
  AND jrd.start_time > now() - interval '1 hour'
  AND (j.jobname LIKE '%price%' OR j.jobname LIKE '%candle%')
UNION ALL
SELECT 
  'stale_data' as alert_type,
  now() as alert_time,
  'Stale price data for ' || symbol as alert_title,
  'No price updates for ' || ROUND(seconds_since_last_price, 0) || ' seconds' as alert_message,
  'warning' as severity
FROM check_price_data_freshness()
WHERE status IN ('STALE', 'INACTIVE')
ORDER BY alert_time DESC;

GRANT SELECT ON v_system_alerts TO authenticated;

-- Add helpful comments
COMMENT ON VIEW v_autonomous_system_dashboard IS 
  'Complete real-time snapshot of autonomous trading system health including cron jobs, price polling, and candle generation';

COMMENT ON VIEW v_cron_job_execution_history IS 
  'Recent execution history of all autonomous system cron jobs with performance metrics';

COMMENT ON VIEW v_price_polling_metrics IS 
  'Time-series metrics for price polling performance over the last 24 hours';

COMMENT ON VIEW v_candle_generation_metrics IS 
  'Real-time statistics for candle aggregation by timeframe';

COMMENT ON VIEW v_system_alerts IS 
  'Recent errors and alerts from the autonomous trading system';

COMMENT ON FUNCTION get_system_uptime_percentage() IS 
  'Calculates system uptime percentage based on price polling success rate over last 24 hours';

COMMENT ON FUNCTION get_polling_success_rate(interval) IS 
  'Returns detailed polling success statistics for a specified time window';
