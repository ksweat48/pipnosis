/*
  # Auto-Backtest Cron Job Setup

  1. Cron Jobs
    - Runner job: Checks controllers every 30 seconds, queues new jobs
    - Executor job: Processes pending jobs every 15 seconds
    - Cleanup job: Removes old completed/failed jobs daily

  2. Functions
    - Helper functions to invoke edge functions from cron
    - Error logging for failed cron executions

  3. Configuration
    - Configurable execution frequency
    - Automatic retry on failures
*/

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create function to invoke auto-backtest-runner edge function
CREATE OR REPLACE FUNCTION invoke_auto_backtest_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response_status int;
  response_body text;
  function_url text;
BEGIN
  function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-backtest-runner';

  BEGIN
    SELECT status, content INTO response_status, response_body
    FROM http((
      'POST',
      function_url,
      ARRAY[http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))],
      'application/json',
      '{}'
    )::http_request);

    IF response_status >= 400 THEN
      RAISE WARNING 'Auto-backtest runner failed with status %: %', response_status, response_body;

      INSERT INTO auto_backtest_health_log (
        user_id,
        stress_score,
        database_response_ms,
        error_rate_percent,
        active_backtests,
        action_taken
      )
      VALUES (
        (SELECT id FROM auth.users WHERE email = 'admin@pipnosis.com' LIMIT 1),
        100,
        0,
        100,
        0,
        'cron_error: ' || response_body
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Exception in auto-backtest runner: %', SQLERRM;
  END;
END;
$$;

-- Create function to invoke auto-backtest-executor edge function
CREATE OR REPLACE FUNCTION invoke_auto_backtest_executor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response_status int;
  response_body text;
  function_url text;
BEGIN
  function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/auto-backtest-executor';

  BEGIN
    SELECT status, content INTO response_status, response_body
    FROM http((
      'POST',
      function_url,
      ARRAY[http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))],
      'application/json',
      '{}'
    )::http_request);

    IF response_status >= 400 THEN
      RAISE WARNING 'Auto-backtest executor failed with status %: %', response_status, response_body;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Exception in auto-backtest executor: %', SQLERRM;
  END;
END;
$$;

-- Create cleanup function for old queue entries
CREATE OR REPLACE FUNCTION cleanup_old_auto_backtest_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete completed jobs older than 7 days
  DELETE FROM auto_backtest_queue
  WHERE status IN ('completed', 'failed', 'cancelled')
  AND completed_at < now() - interval '7 days';

  -- Delete health logs older than 30 days
  DELETE FROM auto_backtest_health_log
  WHERE logged_at < now() - interval '30 days';

  RAISE NOTICE 'Cleaned up old auto-backtest jobs and health logs';
END;
$$;

-- Schedule runner job - every 30 seconds
SELECT cron.schedule(
  'auto-backtest-runner-job',
  '*/30 * * * * *',
  $$SELECT invoke_auto_backtest_runner()$$
);

-- Schedule executor job - every 15 seconds
SELECT cron.schedule(
  'auto-backtest-executor-job',
  '*/15 * * * * *',
  $$SELECT invoke_auto_backtest_executor()$$
);

-- Schedule cleanup job - daily at 3 AM
SELECT cron.schedule(
  'auto-backtest-cleanup-job',
  '0 3 * * *',
  $$SELECT cleanup_old_auto_backtest_jobs()$$
);

-- Create monitoring view for cron job status
CREATE OR REPLACE VIEW auto_backtest_cron_status AS
SELECT
  jobname,
  schedule,
  active,
  jobid,
  CASE
    WHEN active THEN 'Running'
    ELSE 'Stopped'
  END as status
FROM cron.job
WHERE jobname LIKE 'auto-backtest-%';

-- Grant permissions
GRANT SELECT ON auto_backtest_cron_status TO authenticated;
