/*
  # EMERGENCY: Disable All Resource-Intensive Cron Jobs

  This migration immediately unschedules all cron jobs that are causing database
  resource exhaustion (100% CPU, 100% Memory).

  ## Problem
  Multiple cron jobs running every 10-30 seconds are exhausting database connections:
  - continuous-price-polling: Loops 20 times per minute with 3-second sleeps
  - auto-backtest-executor: Runs every 15 seconds
  - quality metrics calculator: Nested loops every 15 minutes
  - quality alerts: Runs every 10 minutes

  ## Solution
  Unschedule all these jobs immediately. Polling will continue via client-side code.
  Keep only essential daily cleanup jobs.

  ## Jobs Being Disabled
  1. continuous-price-polling - REMOVED (client-side handles this)
  2. auto-backtest-executor - REMOVED (will be replaced with on-demand system)
  3. calculate-quality-metrics - REMOVED (too resource intensive)
  4. check-quality-alerts - REMOVED (unnecessary polling)
  5. polling-outage-monitor - REMOVED (client-side handles this)
  6. repair-candles-hourly - KEPT but changed to daily

  ## Jobs Being Kept
  1. cleanup-old-logs - Daily at 3 AM (minimal resource use)
  2. cleanup-polling-health - Daily at 3 AM (minimal resource use)
  3. repair-candles-daily - Daily at 2 AM (changed from hourly)
*/

-- =====================================================
-- 1. UNSCHEDULE ALL CONTINUOUS POLLING CRON JOBS
-- =====================================================

-- Remove continuous price polling (the worst offender - 20 loops per minute!)
SELECT cron.unschedule('continuous-price-polling');

-- Remove auto backtest executors (running every 15 seconds)
SELECT cron.unschedule('auto-backtest-executor');
SELECT cron.unschedule('auto-backtest-runner');
SELECT cron.unschedule('backtest-executor');
SELECT cron.unschedule('process-backtest-queue');

-- Remove quality metrics calculators (nested loops)
SELECT cron.unschedule('calculate-quality-metrics');
SELECT cron.unschedule('check-quality-alerts');

-- Remove polling outage monitor (every 5 minutes, client handles this)
SELECT cron.unschedule('polling-outage-monitor');

-- Remove repair-candles-hourly (replace with daily)
SELECT cron.unschedule('repair-candles-hourly');

-- =====================================================
-- 2. REPLACE HOURLY CANDLE REPAIR WITH DAILY VERSION
-- =====================================================

-- Schedule candle repair once per day at 2 AM (not every hour!)
SELECT cron.schedule(
  'repair-candles-daily',
  '0 2 * * *',  -- Daily at 2 AM
  $$
  INSERT INTO cron_job_execution_log (job_name, status)
  VALUES ('repair-candles-daily', 'running');

  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/repair-candles?hours=24',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  ) AS request_id;
  $$
);

-- =====================================================
-- 3. KEEP DAILY CLEANUP JOBS (LOW RESOURCE USE)
-- =====================================================

-- These jobs are fine - they run once per day during off-hours
-- cleanup-old-logs: Already scheduled at 3 AM daily
-- cleanup-polling-health: Already scheduled hourly (minimal operation)

-- =====================================================
-- 4. LOG WHAT WAS DISABLED
-- =====================================================

INSERT INTO cron_job_execution_log (job_name, status, result)
VALUES (
  'emergency-cron-cleanup',
  'completed',
  jsonb_build_object(
    'action', 'disabled_resource_intensive_crons',
    'reason', 'database_resource_exhaustion',
    'disabled_jobs', jsonb_build_array(
      'continuous-price-polling',
      'auto-backtest-executor',
      'auto-backtest-runner',
      'backtest-executor',
      'process-backtest-queue',
      'calculate-quality-metrics',
      'check-quality-alerts',
      'polling-outage-monitor',
      'repair-candles-hourly'
    ),
    'kept_jobs', jsonb_build_array(
      'cleanup-old-logs',
      'cleanup-polling-health',
      'repair-candles-daily'
    ),
    'timestamp', now(),
    'note', 'Client-side polling will continue. Backtest system will be redesigned as on-demand Edge Functions.'
  )
);

-- =====================================================
-- 5. CREATE VIEW TO CHECK ACTIVE CRON JOBS
-- =====================================================

CREATE OR REPLACE VIEW active_cron_jobs AS
SELECT
  jobid,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active,
  jobname
FROM cron.job
ORDER BY jobname;

GRANT SELECT ON active_cron_jobs TO authenticated;

COMMENT ON VIEW active_cron_jobs IS 'Shows all active cron jobs. After this migration, should only show daily cleanup jobs.';

-- =====================================================
-- 6. CREATE FUNCTION TO CHECK DATABASE HEALTH
-- =====================================================

CREATE OR REPLACE FUNCTION check_database_resource_usage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_connections integer;
  v_max_connections integer;
  v_connection_percentage numeric;
  v_active_cron_jobs integer;
BEGIN
  -- Count active connections
  SELECT COUNT(*) INTO v_active_connections
  FROM pg_stat_activity
  WHERE state = 'active';

  -- Get max connections
  SELECT setting::integer INTO v_max_connections
  FROM pg_settings
  WHERE name = 'max_connections';

  -- Calculate percentage
  v_connection_percentage := (v_active_connections::numeric / v_max_connections::numeric) * 100;

  -- Count active cron jobs
  SELECT COUNT(*) INTO v_active_cron_jobs
  FROM cron.job
  WHERE active = true;

  RETURN jsonb_build_object(
    'active_connections', v_active_connections,
    'max_connections', v_max_connections,
    'connection_usage_percentage', ROUND(v_connection_percentage, 2),
    'active_cron_jobs', v_active_cron_jobs,
    'status', CASE
      WHEN v_connection_percentage < 50 THEN 'healthy'
      WHEN v_connection_percentage < 80 THEN 'warning'
      ELSE 'critical'
    END,
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_database_resource_usage() TO authenticated;

COMMENT ON FUNCTION check_database_resource_usage IS 'Returns current database resource usage metrics. Use to monitor health after cron job cleanup.';
