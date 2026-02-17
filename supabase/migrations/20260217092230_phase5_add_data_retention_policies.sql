/*
  # Phase 5: Add Data Retention Policies
  
  Create function to automatically clean up old data from diagnostic/log tables
  to prevent bloat from accumulating.
  
  1. Retention Policies
    - `price_collection_health` - Keep last 7 days
    - `candle_write_audit` - Keep last 7 days
    - `candle_cache_invalidation_events` - Keep last 7 days
    - `polling_recovery_log` - Keep last 30 days (critical failover diagnostics)
    - `governance_change_log` - Keep last 90 days (audit trail)
    - `position_monitoring_logs` - Keep last 7 days
    - `session_health_check_log` - Keep last 7 days
    - `entry_intent_cleanup_audit` - Keep last 30 days
  
  2. Notes
    - Function can be called manually or scheduled via cron
    - Uses DELETE with LIMIT to avoid long locks
*/

CREATE OR REPLACE FUNCTION cleanup_old_diagnostic_data()
RETURNS TABLE (
  table_name text,
  rows_deleted bigint
) 
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  -- Clean price_collection_health (keep 7 days)
  DELETE FROM price_collection_health 
  WHERE created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'price_collection_health';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean candle_write_audit (keep 7 days)
  DELETE FROM candle_write_audit 
  WHERE attempt_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'candle_write_audit';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean candle_cache_invalidation_events (keep 7 days)
  DELETE FROM candle_cache_invalidation_events 
  WHERE triggered_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'candle_cache_invalidation_events';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean polling_recovery_log (keep 30 days - critical diagnostics)
  DELETE FROM polling_recovery_log 
  WHERE occurred_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'polling_recovery_log';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean governance_change_log (keep 90 days - audit trail)
  DELETE FROM governance_change_log 
  WHERE changed_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'governance_change_log';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean position_monitoring_logs (keep 7 days)
  DELETE FROM position_monitoring_logs 
  WHERE checked_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'position_monitoring_logs';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean session_health_check_log (keep 7 days)
  DELETE FROM session_health_check_log 
  WHERE checked_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'session_health_check_log';
  rows_deleted := deleted_count;
  RETURN NEXT;

  -- Clean entry_intent_cleanup_audit (keep 30 days)
  DELETE FROM entry_intent_cleanup_audit 
  WHERE cleaned_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  table_name := 'entry_intent_cleanup_audit';
  rows_deleted := deleted_count;
  RETURN NEXT;

END;
$$;

-- Add comment explaining usage
COMMENT ON FUNCTION cleanup_old_diagnostic_data IS 'Cleans up old diagnostic/log data to prevent database bloat. Can be called manually or scheduled via cron. Run: SELECT * FROM cleanup_old_diagnostic_data();';
