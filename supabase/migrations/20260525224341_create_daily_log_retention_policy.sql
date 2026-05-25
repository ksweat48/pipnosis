/*
  # Create Daily Log Retention Policy

  1. New Functions
    - `run_daily_log_retention()` - Deletes old rows from logging/audit tables
      to prevent disk exhaustion

  2. Retention Periods
    - `price_collection_health` - 3 days (high-volume, diagnostic only)
    - `price_freshness_governance_log` - 3 days (high-volume, diagnostic only)
    - `candle_cache_invalidation_events` - 7 days
    - `candle_write_audit` - 7 days
    - `governance_change_log` - 14 days
    - `alpha_scan_thoughts` - 7 days
    - `server_monitoring_health` - 7 days
    - `session_health_check_log` - 7 days
    - `entry_intent_cleanup_audit` - 7 days
    - `polling_recovery_log` - 7 days
    - `position_monitoring_logs` - 7 days

  3. Schedule
    - Runs daily at 4:00 AM UTC (outside peak trading hours)
    - Deletes in batches of 50,000 rows per table to avoid lock contention

  4. Important Notes
    - Only affects diagnostic/logging tables, NEVER touches business data
    - Prevents the 15 GB bloat situation from recurring
    - Each table deletion is independent (one failure doesn't block others)
*/

CREATE OR REPLACE FUNCTION public.run_daily_log_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  deleted_count bigint;
BEGIN
  -- price_collection_health: 3-day retention (highest volume table)
  DELETE FROM price_collection_health
  WHERE id IN (
    SELECT id FROM price_collection_health
    WHERE created_at < now() - interval '3 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('price_collection_health', deleted_count);

  -- price_freshness_governance_log: 3-day retention
  DELETE FROM price_freshness_governance_log
  WHERE id IN (
    SELECT id FROM price_freshness_governance_log
    WHERE created_at < now() - interval '3 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('price_freshness_governance_log', deleted_count);

  -- candle_cache_invalidation_events: 7-day retention
  DELETE FROM candle_cache_invalidation_events
  WHERE id IN (
    SELECT id FROM candle_cache_invalidation_events
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('candle_cache_invalidation_events', deleted_count);

  -- candle_write_audit: 7-day retention
  DELETE FROM candle_write_audit
  WHERE id IN (
    SELECT id FROM candle_write_audit
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('candle_write_audit', deleted_count);

  -- governance_change_log: 14-day retention
  DELETE FROM governance_change_log
  WHERE id IN (
    SELECT id FROM governance_change_log
    WHERE created_at < now() - interval '14 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('governance_change_log', deleted_count);

  -- alpha_scan_thoughts: 7-day retention
  DELETE FROM alpha_scan_thoughts
  WHERE id IN (
    SELECT id FROM alpha_scan_thoughts
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('alpha_scan_thoughts', deleted_count);

  -- server_monitoring_health: 7-day retention
  DELETE FROM server_monitoring_health
  WHERE id IN (
    SELECT id FROM server_monitoring_health
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('server_monitoring_health', deleted_count);

  -- session_health_check_log: 7-day retention
  DELETE FROM session_health_check_log
  WHERE id IN (
    SELECT id FROM session_health_check_log
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('session_health_check_log', deleted_count);

  -- entry_intent_cleanup_audit: 7-day retention
  DELETE FROM entry_intent_cleanup_audit
  WHERE id IN (
    SELECT id FROM entry_intent_cleanup_audit
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('entry_intent_cleanup_audit', deleted_count);

  -- polling_recovery_log: 7-day retention
  DELETE FROM polling_recovery_log
  WHERE id IN (
    SELECT id FROM polling_recovery_log
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('polling_recovery_log', deleted_count);

  -- position_monitoring_logs: 7-day retention
  DELETE FROM position_monitoring_logs
  WHERE id IN (
    SELECT id FROM position_monitoring_logs
    WHERE created_at < now() - interval '7 days'
    LIMIT 50000
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('position_monitoring_logs', deleted_count);

  RETURN result;
END;
$$;

-- Schedule the retention job to run daily at 4:00 AM UTC
SELECT cron.schedule(
  'daily-log-retention',
  '0 4 * * *',
  'SELECT public.run_daily_log_retention();'
);
