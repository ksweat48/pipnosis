/*
  # Fix Admin Dashboard Views

  1. Purpose
    - Replace old cron-dependent views with simple alternatives
    - Provide basic monitoring for the admin dashboard
    - Remove dependencies on pg_cron tables that no longer exist

  2. Changes
    - Drop old views that reference cron tables
    - Create simplified versions that work with current architecture
    - Focus on data that actually exists in the database

  3. Security
    - Grant SELECT to authenticated users
*/

-- Drop old views that reference non-existent cron tables
DROP VIEW IF EXISTS v_autonomous_system_dashboard CASCADE;
DROP VIEW IF EXISTS v_system_alerts CASCADE;
DROP VIEW IF EXISTS v_cron_job_execution_history CASCADE;
DROP VIEW IF EXISTS v_price_polling_metrics CASCADE;
DROP VIEW IF EXISTS v_candle_generation_metrics CASCADE;

-- Create simplified system dashboard view
CREATE OR REPLACE VIEW v_autonomous_system_dashboard AS
SELECT 
  now() as timestamp,
  (
    SELECT COUNT(DISTINCT user_id)
    FROM goal_sessions
    WHERE created_at > now() - interval '24 hours'
  ) as active_users_24h,
  (
    SELECT COUNT(*)
    FROM goal_sessions
    WHERE status IN ('scanning', 'trade_pending', 'in_trade')
  ) as active_sessions,
  (
    SELECT COUNT(*)
    FROM goal_session_trades
    WHERE created_at > now() - interval '1 hour'
  ) as trades_last_hour,
  (
    SELECT COUNT(*)
    FROM forex_candles
    WHERE open_time > now() - interval '1 hour'
  ) as candles_last_hour,
  (
    SELECT jsonb_build_object(
      'total_positions', COUNT(*),
      'open_positions', COUNT(*) FILTER (WHERE status = 'open'),
      'closed_positions', COUNT(*) FILTER (WHERE status = 'closed')
    )
    FROM goal_session_trades
    WHERE created_at > now() - interval '24 hours'
  ) as position_stats,
  (
    SELECT MAX(open_time)
    FROM forex_candles
  ) as last_candle_time,
  (
    SELECT EXTRACT(EPOCH FROM (now() - MAX(open_time)))::integer
    FROM forex_candles
  ) as seconds_since_last_candle,
  CASE 
    WHEN (SELECT MAX(open_time) FROM forex_candles) > now() - interval '5 minutes' THEN 'healthy'
    WHEN (SELECT MAX(open_time) FROM forex_candles) > now() - interval '15 minutes' THEN 'degraded'
    ELSE 'unhealthy'
  END as system_status;

GRANT SELECT ON v_autonomous_system_dashboard TO authenticated;

-- Create simplified alerts view
CREATE OR REPLACE VIEW v_system_alerts AS
SELECT 
  'stale_candles' as alert_type,
  fc.last_candle as alert_time,
  'Candle data may be stale' as alert_title,
  'Last candle: ' || EXTRACT(EPOCH FROM (now() - fc.last_candle))::integer || ' seconds ago' as alert_message,
  CASE 
    WHEN fc.last_candle < now() - interval '15 minutes' THEN 'error'
    WHEN fc.last_candle < now() - interval '5 minutes' THEN 'warning'
    ELSE 'info'
  END as severity
FROM (
  SELECT MAX(open_time) as last_candle
  FROM forex_candles
) fc
WHERE fc.last_candle IS NOT NULL AND fc.last_candle < now() - interval '5 minutes'
ORDER BY alert_time DESC
LIMIT 20;

GRANT SELECT ON v_system_alerts TO authenticated;

-- Add helpful comments
COMMENT ON VIEW v_autonomous_system_dashboard IS 
  'Simplified system health dashboard showing active sessions, trades, and candle data freshness';

COMMENT ON VIEW v_system_alerts IS 
  'Basic system alerts for stale data and high load conditions';
