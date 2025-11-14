/*
  # EMERGENCY: Safely Disable Resource-Intensive Cron Jobs

  This migration safely unschedules cron jobs that may be causing database
  resource exhaustion. It checks if each job exists before attempting to unschedule.

  ## Problem
  Multiple cron jobs running frequently are exhausting database connections and causing
  100% CPU and memory usage.

  ## Solution
  Safely unschedule resource-intensive jobs without failing if they don't exist.
  Keep only essential daily cleanup jobs.
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
    -- Check if job exists before trying to unschedule
    SELECT EXISTS(
      SELECT 1 FROM cron.job WHERE jobname = job_name
    ) INTO job_exists;

    IF job_exists THEN
      PERFORM cron.unschedule(job_name);
      RAISE NOTICE '✓ Unscheduled: %', job_name;
      jobs_removed := jobs_removed + 1;
    ELSE
      RAISE NOTICE '○ Job does not exist (skipping): %', job_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'Total jobs removed: %', jobs_removed;
END $$;

-- =====================================================
-- 2. REPLACE HOURLY CANDLE REPAIR WITH DAILY VERSION
-- =====================================================

DO $$
BEGIN
  -- First remove if exists
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'repair-candles-daily') THEN
    PERFORM cron.unschedule('repair-candles-daily');
    RAISE NOTICE 'Removed existing repair-candles-daily';
  END IF;

  -- Create new daily job
  PERFORM cron.schedule(
    'repair-candles-daily',
    '0 2 * * *',  -- Daily at 2 AM
    $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/repair-candles?hours=24',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      )
    )
    $$
  );

  RAISE NOTICE '✓ Created: repair-candles-daily (runs at 2 AM)';
END $$;

-- =====================================================
-- 3. LOG WHAT WAS DONE
-- =====================================================

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'cron_job_execution_log') THEN
    INSERT INTO cron_job_execution_log (job_name, status, result)
    VALUES (
      'emergency-cron-cleanup',
      'completed',
      jsonb_build_object(
        'action', 'disabled_resource_intensive_crons',
        'reason', 'database_resource_exhaustion',
        'timestamp', now(),
        'note', 'Safely removed all resource-intensive cron jobs. Client-side polling will continue.'
      )
    );
    RAISE NOTICE '✓ Logged cleanup action';
  ELSE
    RAISE NOTICE '○ cron_job_execution_log table does not exist, skipping log';
  END IF;
END $$;

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

-- =====================================================
-- 5. CREATE FUNCTION TO CHECK DATABASE HEALTH
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

-- =====================================================
-- 6. SHOW CURRENT STATUS
-- =====================================================

-- Show remaining active cron jobs
SELECT
  '✓ EMERGENCY CLEANUP COMPLETE' as message,
  COUNT(*) as remaining_active_jobs
FROM cron.job
WHERE active = true;

-- Show current resource usage
SELECT check_database_resource_usage() as current_status;
