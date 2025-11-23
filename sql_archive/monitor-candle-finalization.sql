-- Candle Finalization Monitoring Queries
-- Use these queries to monitor the health and performance of the candle finalization system

-- ============================================================================
-- RECENT EXECUTIONS (Last 50)
-- ============================================================================
-- Shows the most recent finalization runs with their status and performance
SELECT
  started_at,
  completed_at,
  status,
  candles_processed,
  duration_ms,
  lock_acquired,
  CASE
    WHEN sample_errors IS NOT NULL AND array_length(sample_errors, 1) > 0
    THEN sample_errors[1]
    ELSE NULL
  END as first_error
FROM v_recent_finalizations
ORDER BY started_at DESC;

-- ============================================================================
-- SYSTEM HEALTH (Last 24 hours)
-- ============================================================================
-- Aggregated health metrics by hour and status
SELECT
  hour,
  status,
  execution_count,
  ROUND(avg_candles_processed::numeric, 2) as avg_candles,
  ROUND(avg_duration_ms::numeric, 0) as avg_duration_ms,
  ROUND(max_duration_ms::numeric, 0) as max_duration_ms,
  locks_acquired,
  locks_skipped
FROM v_finalization_health
ORDER BY hour DESC, status;

-- ============================================================================
-- ERROR SUMMARY (Last 24 hours)
-- ============================================================================
-- Shows all executions that had errors
SELECT
  started_at,
  status,
  candles_processed,
  duration_ms,
  errors
FROM candle_finalization_executions
WHERE (errors IS NOT NULL AND array_length(errors, 1) > 0)
  AND started_at > now() - interval '24 hours'
ORDER BY started_at DESC;

-- ============================================================================
-- SUCCESS RATE (Last 24 hours)
-- ============================================================================
-- Calculate overall success rate and statistics
SELECT
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE status = 'success') as successful,
  COUNT(*) FILTER (WHERE status = 'partial_success') as partial_success,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
  COUNT(*) FILTER (WHERE status = 'timeout') as timeouts,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'success') / COUNT(*), 2) as success_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'skipped') / COUNT(*), 2) as skip_rate_pct,
  SUM(candles_processed) as total_candles_processed,
  ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms,
  ROUND(MAX(duration_ms)::numeric, 0) as max_duration_ms
FROM candle_finalization_executions
WHERE started_at > now() - interval '24 hours';

-- ============================================================================
-- LOCK CONTENTION ANALYSIS
-- ============================================================================
-- Shows how often concurrent executions are prevented
SELECT
  date_trunc('hour', started_at) as hour,
  COUNT(*) as total_attempts,
  COUNT(*) FILTER (WHERE lock_acquired = true) as locks_acquired,
  COUNT(*) FILTER (WHERE lock_acquired = false) as locks_skipped,
  ROUND(100.0 * COUNT(*) FILTER (WHERE lock_acquired = false) / COUNT(*), 2) as skip_percentage
FROM candle_finalization_executions
WHERE started_at > now() - interval '24 hours'
GROUP BY date_trunc('hour', started_at)
ORDER BY hour DESC;

-- ============================================================================
-- PERFORMANCE TRENDS (Hourly)
-- ============================================================================
-- Track how performance changes over time
SELECT
  date_trunc('hour', started_at) as hour,
  COUNT(*) as executions,
  ROUND(AVG(candles_processed)::numeric, 2) as avg_candles,
  ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms,
  ROUND(MIN(duration_ms)::numeric, 0) as min_duration_ms,
  ROUND(MAX(duration_ms)::numeric, 0) as max_duration_ms,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::numeric, 0) as median_duration_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 0) as p95_duration_ms
FROM candle_finalization_executions
WHERE started_at > now() - interval '24 hours'
  AND lock_acquired = true
  AND status IN ('success', 'partial_success')
GROUP BY date_trunc('hour', started_at)
ORDER BY hour DESC;

-- ============================================================================
-- CURRENT RUNNING EXECUTIONS
-- ============================================================================
-- Check if any executions are currently running (should be 0 or 1)
SELECT
  id,
  started_at,
  EXTRACT(EPOCH FROM (now() - started_at)) as running_seconds,
  lock_acquired
FROM candle_finalization_executions
WHERE status = 'running'
ORDER BY started_at DESC;

-- ============================================================================
-- STALE/STUCK EXECUTIONS
-- ============================================================================
-- Executions that have been running for more than 5 minutes (potential issues)
SELECT
  id,
  started_at,
  status,
  EXTRACT(EPOCH FROM (now() - started_at)) as running_seconds,
  lock_acquired
FROM candle_finalization_executions
WHERE status = 'running'
  AND started_at < now() - interval '5 minutes'
ORDER BY started_at;

-- ============================================================================
-- CANDLE STATE OVERVIEW
-- ============================================================================
-- Check the current state of candles waiting to be finalized
SELECT
  symbol,
  timeframe,
  COUNT(*) as pending_candles,
  MIN(close_time) as oldest_close_time,
  MAX(close_time) as newest_close_time,
  EXTRACT(EPOCH FROM (now() - MIN(close_time))) / 60 as oldest_pending_minutes
FROM candle_state
WHERE is_complete = false
  AND close_time <= now()
GROUP BY symbol, timeframe
ORDER BY oldest_pending_minutes DESC;

-- ============================================================================
-- INCOMPLETE CANDLES READY FOR FINALIZATION
-- ============================================================================
-- Shows how many candles are currently ready to be finalized
SELECT
  COUNT(*) as candles_ready_for_finalization,
  COUNT(DISTINCT symbol) as symbols_with_pending_candles,
  COUNT(DISTINCT timeframe) as timeframes_with_pending_candles,
  MIN(close_time) as oldest_ready_candle,
  MAX(close_time) as newest_ready_candle
FROM candle_state
WHERE is_complete = false
  AND close_time <= now();

-- ============================================================================
-- EXECUTION FREQUENCY CHECK
-- ============================================================================
-- Verify cron job is running every minute as expected
SELECT
  date_trunc('minute', started_at) as minute,
  COUNT(*) as executions_in_minute,
  STRING_AGG(status::text, ', ') as statuses
FROM candle_finalization_executions
WHERE started_at > now() - interval '1 hour'
GROUP BY date_trunc('minute', started_at)
HAVING COUNT(*) > 1  -- Show minutes with multiple executions
ORDER BY minute DESC;

-- ============================================================================
-- CLEANUP FUNCTION TEST
-- ============================================================================
-- Manually run the cleanup function to test it
-- SELECT cleanup_stale_finalization_locks();

-- ============================================================================
-- MANUAL FINALIZATION TEST
-- ============================================================================
-- Manually trigger finalization to test the function
-- SELECT finalize_completed_candles();
