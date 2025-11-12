/*
  # Fix Auto-Backtest Executor Cron Job

  1. Problem
    - Migration 20251112070642 unscheduled the executor cron job
    - Jobs are being created but never processed
    - Queue is filling up with pending jobs that sit forever

  2. Solution
    - Re-enable the executor cron job to process pending jobs
    - Use the existing auto-backtest-executor Edge Function
    - Schedule to run every 15 seconds

  3. Changes
    - Unschedule any old executor jobs (cleanup)
    - Schedule new executor job that calls the Edge Function
    - Edge Function processes up to 5 pending jobs per execution
*/

-- First, clean up any existing executor jobs
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname LIKE '%executor%';

-- Create a wrapper function to call the executor Edge Function
-- This will be called by the cron job every 15 seconds
CREATE OR REPLACE FUNCTION trigger_auto_backtest_executor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url text;
  v_service_key text;
  v_function_url text;
  v_response record;
BEGIN
  -- Get Supabase configuration
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'Supabase configuration not found. Cannot trigger executor.';
    RETURN;
  END IF;

  v_function_url := v_supabase_url || '/functions/v1/auto-backtest-executor';

  -- Call the Edge Function using http extension
  BEGIN
    SELECT status, content INTO v_response
    FROM http((
      'POST',
      v_function_url,
      ARRAY[http_header('Authorization', 'Bearer ' || v_service_key)],
      'application/json',
      '{}'
    )::http_request);

    IF v_response.status >= 400 THEN
      RAISE WARNING 'Auto-backtest executor failed with status %: %',
        v_response.status, v_response.content;
    ELSE
      RAISE NOTICE 'Auto-backtest executor completed successfully';
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Exception calling auto-backtest executor: %', SQLERRM;
  END;
END;
$$;

-- Schedule the executor job to run every 15 seconds
-- This will pick up pending jobs from the queue and process them
SELECT cron.schedule(
  'auto-backtest-executor-v3',
  '*/15 * * * * *',
  $$SELECT trigger_auto_backtest_executor()$$
);

COMMENT ON FUNCTION trigger_auto_backtest_executor() IS
  'Triggers the auto-backtest-executor Edge Function to process pending jobs. Called by cron every 15 seconds.';

-- Verify the job was created
DO $$
DECLARE
  v_job_count int;
BEGIN
  SELECT COUNT(*) INTO v_job_count
  FROM cron.job
  WHERE jobname = 'auto-backtest-executor-v3';

  IF v_job_count > 0 THEN
    RAISE NOTICE '✅ Executor cron job created successfully';
  ELSE
    RAISE WARNING '❌ Failed to create executor cron job';
  END IF;
END $$;
