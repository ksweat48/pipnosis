/*
  # Automated Data Retention and Cleanup System

  1. Purpose
    - Prevent disk space issues by automatically cleaning old data
    - Maintain optimal database performance
    - Keep only relevant historical data

  2. Cleanup Policies
    - Realtime prices: Keep last 24 hours
    - System logs: Keep last 7 days
    - Synthetic data: Manual cleanup only (not auto-regenerated)
    - AI learning data: Keep all (part of training history)

  3. Scheduled Jobs
    - Daily cleanup at 2 AM UTC
    - Weekly full maintenance on Sundays
*/

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS cleanup_old_realtime_prices();
DROP FUNCTION IF EXISTS cleanup_old_system_logs();
DROP FUNCTION IF EXISTS maintain_database_health();
DROP FUNCTION IF EXISTS generate_cleanup_report();

-- Create function to clean old realtime prices
CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices()
RETURNS void AS $$
BEGIN
  DELETE FROM realtime_prices
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Create function to clean old system logs
CREATE OR REPLACE FUNCTION cleanup_old_system_logs()
RETURNS void AS $$
BEGIN
  -- Clean logs older than 7 days
  DELETE FROM candle_finalization_executions
  WHERE started_at < NOW() - INTERVAL '7 days';

  DELETE FROM function_execution_logs
  WHERE created_at < NOW() - INTERVAL '7 days';

  DELETE FROM candle_aggregation_log
  WHERE created_at < NOW() - INTERVAL '7 days';

  DELETE FROM candle_gap_fill_log
  WHERE created_at < NOW() - INTERVAL '7 days';

  DELETE FROM polling_recovery_log
  WHERE created_at < NOW() - INTERVAL '7 days';

  -- Keep only last 1000 system load metrics
  DELETE FROM system_load_metrics
  WHERE id NOT IN (
    SELECT id FROM system_load_metrics
    ORDER BY created_at DESC
    LIMIT 1000
  );
END;
$$ LANGUAGE plpgsql;

-- Create function to vacuum and analyze tables
CREATE OR REPLACE FUNCTION maintain_database_health()
RETURNS void AS $$
BEGIN
  -- Vacuum large tables to reclaim space
  VACUUM ANALYZE forex_candles;
  VACUUM ANALYZE realtime_prices;
  VACUUM ANALYZE ai_trade_analysis;
  VACUUM ANALYZE synthetic_candles;
END;
$$ LANGUAGE plpgsql;

-- Create function for comprehensive cleanup report
CREATE OR REPLACE FUNCTION generate_cleanup_report()
RETURNS TABLE(
  table_name text,
  size_mb numeric,
  row_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.tablename::text,
    ROUND((pg_total_relation_size(t.schemaname||'.'||t.tablename) / 1048576.0)::numeric, 2) as size_mb,
    0::bigint as row_count
  FROM pg_tables t
  WHERE t.schemaname = 'public'
  ORDER BY pg_total_relation_size(t.schemaname||'.'||t.tablename) DESC
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;

-- Unschedule existing jobs if they exist
SELECT cron.unschedule('daily-realtime-prices-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-realtime-prices-cleanup');
SELECT cron.unschedule('daily-system-logs-cleanup') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-system-logs-cleanup');
SELECT cron.unschedule('weekly-database-maintenance') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-database-maintenance');

-- Schedule daily realtime prices cleanup at 2:00 AM UTC
SELECT cron.schedule(
  'daily-realtime-prices-cleanup',
  '0 2 * * *',
  $$SELECT cleanup_old_realtime_prices()$$
);

-- Schedule daily system logs cleanup at 2:30 AM UTC
SELECT cron.schedule(
  'daily-system-logs-cleanup',
  '30 2 * * *',
  $$SELECT cleanup_old_system_logs()$$
);

-- Schedule weekly database maintenance on Sundays at 3:00 AM UTC
SELECT cron.schedule(
  'weekly-database-maintenance',
  '0 3 * * 0',
  $$SELECT maintain_database_health()$$
);
