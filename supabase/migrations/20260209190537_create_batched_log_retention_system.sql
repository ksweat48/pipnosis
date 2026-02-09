/*
  # Batched Log Retention System

  ## Problem
  The previous cleanup_old_log_data() function tried to delete all old rows at once,
  causing timeouts on tables with millions of rows. We need a batched approach that
  safely prunes ~50K rows per table per invocation.

  ## Solution
  Replace with cleanup_old_log_data_batched() that:
  1. Deletes max 50,000 rows per table per call
  2. Returns count of rows deleted per table
  3. Returns whether more cleanup is needed (for callers to re-invoke)
  4. Safe for hourly execution from Netlify cron

  ## Retention Periods
  - price_collection_health: 3 days
  - price_freshness_governance_log: 3 days
  - candle_cache_invalidation_events: 3 days
  - candle_write_audit: 7 days
  - alpha_scan_thoughts: 7 days
  - polling_recovery_log: 3 days
  - entry_monitoring_logs: 7 days
  - governance_change_log: 14 days
  - position_monitoring_logs: 7 days
  - cache_stats_log: 3 days
  - session_health_check_log: 7 days
  - server_monitoring_health: 3 days

  ## Security
  - SECURITY DEFINER for RLS bypass on log tables
  - Granted to service_role only
*/

CREATE OR REPLACE FUNCTION public.cleanup_old_log_data_batched(
  max_rows_per_table integer DEFAULT 50000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  deleted_count integer;
  has_more boolean := false;
BEGIN
  DELETE FROM price_collection_health
  WHERE id IN (
    SELECT id FROM price_collection_health
    WHERE created_at < now() - interval '3 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('price_collection_health', deleted_count);

  DELETE FROM price_freshness_governance_log
  WHERE id IN (
    SELECT id FROM price_freshness_governance_log
    WHERE created_at < now() - interval '3 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('price_freshness_governance_log', deleted_count);

  DELETE FROM candle_cache_invalidation_events
  WHERE id IN (
    SELECT id FROM candle_cache_invalidation_events
    WHERE created_at < now() - interval '3 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('candle_cache_invalidation_events', deleted_count);

  DELETE FROM candle_write_audit
  WHERE id IN (
    SELECT id FROM candle_write_audit
    WHERE attempt_at < now() - interval '7 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('candle_write_audit', deleted_count);

  DELETE FROM alpha_scan_thoughts
  WHERE id IN (
    SELECT id FROM alpha_scan_thoughts
    WHERE created_at < now() - interval '7 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('alpha_scan_thoughts', deleted_count);

  DELETE FROM polling_recovery_log
  WHERE id IN (
    SELECT id FROM polling_recovery_log
    WHERE created_at < now() - interval '3 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('polling_recovery_log', deleted_count);

  DELETE FROM entry_monitoring_logs
  WHERE id IN (
    SELECT id FROM entry_monitoring_logs
    WHERE created_at < now() - interval '7 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('entry_monitoring_logs', deleted_count);

  DELETE FROM governance_change_log
  WHERE id IN (
    SELECT id FROM governance_change_log
    WHERE created_at < now() - interval '14 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('governance_change_log', deleted_count);

  DELETE FROM position_monitoring_logs
  WHERE id IN (
    SELECT id FROM position_monitoring_logs
    WHERE created_at < now() - interval '7 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('position_monitoring_logs', deleted_count);

  DELETE FROM cache_stats_log
  WHERE id IN (
    SELECT id FROM cache_stats_log
    WHERE created_at < now() - interval '3 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('cache_stats_log', deleted_count);

  DELETE FROM session_health_check_log
  WHERE id IN (
    SELECT id FROM session_health_check_log
    WHERE created_at < now() - interval '7 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('session_health_check_log', deleted_count);

  DELETE FROM server_monitoring_health
  WHERE id IN (
    SELECT id FROM server_monitoring_health
    WHERE created_at < now() - interval '3 days'
    LIMIT max_rows_per_table
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count >= max_rows_per_table THEN has_more := true; END IF;
  result := result || jsonb_build_object('server_monitoring_health', deleted_count);

  result := result || jsonb_build_object('has_more', has_more);

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_old_log_data_batched(integer) TO service_role;