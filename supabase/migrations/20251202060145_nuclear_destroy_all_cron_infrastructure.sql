/*
  # Nuclear Destruction of All Supabase Cron Infrastructure

  Removes all Supabase cron jobs, functions, and tables.
  ALL scheduling MUST use Netlify scheduled functions only.
*/

-- Unschedule all cron jobs
DO $$
DECLARE
  job_record RECORD;
  jobs_removed INTEGER := 0;
BEGIN
  FOR job_record IN SELECT jobid, jobname FROM cron.job LOOP
    BEGIN
      PERFORM cron.unschedule(job_record.jobid::bigint);
      jobs_removed := jobs_removed + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- Drop all cron-only functions
DROP FUNCTION IF EXISTS invoke_continuous_price_poller() CASCADE;
DROP FUNCTION IF EXISTS invoke_price_poller_multiple_times() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_polling_health() CASCADE;
DROP FUNCTION IF EXISTS finalize_completed_candles() CASCADE;
DROP FUNCTION IF EXISTS finalize_completed_candles_safe() CASCADE;
DROP FUNCTION IF EXISTS auto_fill_all_gaps() CASCADE;
DROP FUNCTION IF EXISTS fill_candle_gap(text, text) CASCADE;
DROP FUNCTION IF EXISTS invoke_auto_backtest_executor() CASCADE;
DROP FUNCTION IF EXISTS invoke_auto_backtest_runner() CASCADE;
DROP FUNCTION IF EXISTS auto_backtest_runner_cycle() CASCADE;
DROP FUNCTION IF EXISTS execute_pending_backtest_jobs() CASCADE;
DROP FUNCTION IF EXISTS generate_auto_backtest_job() CASCADE;
DROP FUNCTION IF EXISTS detect_stuck_backtests() CASCADE;
DROP FUNCTION IF EXISTS process_lightweight_jobs() CASCADE;
DROP FUNCTION IF EXISTS cleanup_completed_jobs() CASCADE;
DROP FUNCTION IF EXISTS job_scheduler_cycle() CASCADE;
DROP FUNCTION IF EXISTS check_polling_health() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_execution_logs() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_quality_checks() CASCADE;
DROP FUNCTION IF EXISTS detect_and_repair_candle_gaps() CASCADE;
DROP FUNCTION IF EXISTS repair_candles_for_symbol(text, interval) CASCADE;
DROP FUNCTION IF EXISTS analyze_pattern_batch() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_data() CASCADE;
DROP FUNCTION IF EXISTS archive_old_sessions() CASCADE;

-- Drop cron-related tables
DROP TABLE IF EXISTS candle_state CASCADE;
DROP TABLE IF EXISTS candle_finalization_executions CASCADE;
DROP TABLE IF EXISTS cron_job_execution_log CASCADE;
DROP TABLE IF EXISTS function_execution_log CASCADE;
DROP TABLE IF EXISTS price_polling_health CASCADE;
DROP TABLE IF EXISTS polling_outage_log CASCADE;
DROP TABLE IF EXISTS polling_health_log CASCADE;
DROP TABLE IF EXISTS backtest_job_queue CASCADE;
DROP TABLE IF EXISTS lightweight_job_queue CASCADE;
DROP TABLE IF EXISTS candle_gap_log CASCADE;
DROP TABLE IF EXISTS gap_detection_log CASCADE;
DROP TABLE IF EXISTS data_quality_checks CASCADE;
DROP TABLE IF EXISTS quality_alert_log CASCADE;

-- Drop cron-monitoring views
DROP VIEW IF EXISTS active_cron_jobs CASCADE;
DROP VIEW IF EXISTS cron_job_status CASCADE;
DROP VIEW IF EXISTS polling_health_status CASCADE;

-- Create warning function
CREATE OR REPLACE FUNCTION prevent_cron_jobs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SUPABASE CRON JOBS ARE PERMANENTLY DISABLED. Use Netlify scheduled functions only.';
END;
$$;

COMMENT ON FUNCTION prevent_cron_jobs IS 'Raises error explaining why cron jobs are disabled';
