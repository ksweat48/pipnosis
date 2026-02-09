/*
  # Log Retention System - Reclaim ~2.7GB of Database Space

  ## Problem
  Operational log tables have accumulated months of data with no retention policy.
  These 12 tables consume ~3.1GB (60% of the entire database) and are growing
  rapidly toward the 8GB Supabase Pro plan limit.

  ## Solution
  1. Create a reusable cleanup_old_log_data() RPC function with configurable retention
  2. Execute an initial cleanup to reclaim space immediately
  3. Function can be called by Netlify scheduled functions for ongoing maintenance

  ## Tables and Retention Periods
  - price_collection_health (1994 MB, 7.4M rows) -> keep 3 days
  - price_freshness_governance_log (525 MB, 1.5M rows) -> keep 3 days
  - candle_cache_invalidation_events (149 MB, 792K rows) -> keep 3 days
  - candle_write_audit (147 MB, 387K rows) -> keep 7 days
  - alpha_scan_thoughts (66 MB, 111K rows) -> keep 7 days
  - polling_recovery_log (56 MB, 174K rows) -> keep 3 days
  - entry_monitoring_logs (21 MB, 37K rows) -> keep 7 days
  - governance_change_log (19 MB, 41K rows) -> keep 14 days
  - position_monitoring_logs (19 MB, 53K rows) -> keep 7 days
  - cache_stats_log (14 MB, 41K rows) -> keep 3 days
  - session_health_check_log (12 MB, 28K rows) -> keep 7 days
  - server_monitoring_health (10 MB, 48K rows) -> keep 3 days

  ## Security
  - Function is SECURITY DEFINER to bypass RLS for cleanup
  - Only callable by authenticated users (service role for scheduled jobs)
  - No user-facing data is affected
*/

CREATE OR REPLACE FUNCTION public.cleanup_old_log_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  deleted_count integer;
BEGIN
  -- price_collection_health: 3 day retention (highest volume)
  DELETE FROM price_collection_health
  WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('price_collection_health', deleted_count);

  -- price_freshness_governance_log: 3 day retention
  DELETE FROM price_freshness_governance_log
  WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('price_freshness_governance_log', deleted_count);

  -- candle_cache_invalidation_events: 3 day retention
  DELETE FROM candle_cache_invalidation_events
  WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('candle_cache_invalidation_events', deleted_count);

  -- candle_write_audit: 7 day retention
  DELETE FROM candle_write_audit
  WHERE attempt_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('candle_write_audit', deleted_count);

  -- alpha_scan_thoughts: 7 day retention
  DELETE FROM alpha_scan_thoughts
  WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('alpha_scan_thoughts', deleted_count);

  -- polling_recovery_log: 3 day retention
  DELETE FROM polling_recovery_log
  WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('polling_recovery_log', deleted_count);

  -- entry_monitoring_logs: 7 day retention
  DELETE FROM entry_monitoring_logs
  WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('entry_monitoring_logs', deleted_count);

  -- governance_change_log: 14 day retention (governance audit trail)
  DELETE FROM governance_change_log
  WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('governance_change_log', deleted_count);

  -- position_monitoring_logs: 7 day retention
  DELETE FROM position_monitoring_logs
  WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('position_monitoring_logs', deleted_count);

  -- cache_stats_log: 3 day retention
  DELETE FROM cache_stats_log
  WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('cache_stats_log', deleted_count);

  -- session_health_check_log: 7 day retention
  DELETE FROM session_health_check_log
  WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('session_health_check_log', deleted_count);

  -- server_monitoring_health: 3 day retention
  DELETE FROM server_monitoring_health
  WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || jsonb_build_object('server_monitoring_health', deleted_count);

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_old_log_data() TO service_role;