/*
  # Emergency Fix: Safely Disable Resource-Intensive Cron Jobs and Create Health Functions

  1. Purpose
    - Safely unschedule resource-intensive cron jobs causing database exhaustion
    - Create health monitoring functions needed by the job queue system
    - Prepare database for lightweight job queue implementation

  2. Changes
    - Unschedule multiple continuous polling cron jobs
    - Replace hourly candle repair with daily version
    - Create check_database_resource_usage function
    - Create monitoring views for cron jobs

  3. Security
    - All functions use SECURITY DEFINER for proper execution
    - Grants appropriate permissions to authenticated users
*/

-- =====================================================
-- 1. SAFELY UNSCHEDULE RESOURCE-INTENSIVE CRON JOBS
-- =====================================================

DO $$
DECLARE
  job_names text[] := ARRAY[
    'continuous-price-polling',
    'auto-backtest-executor',
    'auto-backtest-runner',
    'backtest-executor',
    'process-backtest-queue',
    'calculate-quality-metrics',
    'check-quality-alerts',
    'polling-outage-monitor',
    'repair-candles-hourly',
    'job-scheduler',
    'auto-backtest-control',
    'pattern-batch-analyzer'
  ];
  job_name text;
  job_exists boolean;
  jobs_removed integer := 0;
BEGIN
  FOREACH job_name IN ARRAY job_names
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM cron.job WHERE jobname = job_name
    ) INTO job_exists;

    IF job_exists THEN
      PERFORM cron.unschedule(job_name);
      jobs_removed := jobs_removed + 1;
    END IF;
  END LOOP;
END $$;

-- =====================================================
-- 2. REPLACE HOURLY CANDLE REPAIR WITH DAILY VERSION
-- =====================================================

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'repair-candles-daily') THEN
    PERFORM cron.unschedule('repair-candles-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'repair-candles-daily',
  '0 2 * * *',
  $$
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
-- 3. CREATE FUNCTION TO CHECK DATABASE HEALTH
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
  SELECT COUNT(*) INTO v_active_connections
  FROM pg_stat_activity
  WHERE state = 'active';

  SELECT setting::integer INTO v_max_connections
  FROM pg_settings
  WHERE name = 'max_connections';

  v_connection_percentage := (v_active_connections::numeric / v_max_connections::numeric) * 100;

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

-- =====================================================
-- 4. CREATE VIEW TO MONITOR ACTIVE CRON JOBS
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

COMMENT ON VIEW active_cron_jobs IS 'Shows all active cron jobs. After cleanup, should only show daily maintenance jobs.';
COMMENT ON FUNCTION check_database_resource_usage IS 'Returns current database resource usage metrics. Use to monitor health after cron job cleanup.';
