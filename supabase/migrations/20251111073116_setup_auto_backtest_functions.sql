/*
  # Auto-Backtest Helper Functions

  1. Functions
    - Helper functions to invoke edge functions
    - Cleanup function for old data

  2. Configuration
    - Configurable execution frequency
    - Automatic retry on failures
*/

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