/*
  # Fix diagnostic health check function - Column name corrections
  
  The pg_policies table uses 'policyname' not 'policy_name'.
  This migration corrects the column references in diagnose_session_intelligence_health().
*/

DROP FUNCTION IF EXISTS diagnose_session_intelligence_health();

CREATE OR REPLACE FUNCTION diagnose_session_intelligence_health()
RETURNS TABLE (
  check_name text,
  status text,
  details jsonb,
  checked_at timestamptz
) AS $$
BEGIN
  -- Check 1: Recent realtime prices available
  RETURN QUERY SELECT 
    'realtime_prices_freshness'::text,
    CASE 
      WHEN COUNT(*) > 0 AND MIN(created_at) > NOW() - INTERVAL '5 minutes' THEN 'HEALTHY'
      WHEN COUNT(*) > 0 THEN 'STALE'
      ELSE 'NO_DATA'
    END::text,
    jsonb_build_object(
      'record_count', COUNT(*),
      'symbols', COUNT(DISTINCT symbol),
      'oldest_record_age_minutes', EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/60
    )::jsonb,
    NOW()
  FROM realtime_prices
  WHERE created_at > NOW() - INTERVAL '30 minutes';

  -- Check 2: Candle data availability
  RETURN QUERY SELECT 
    'forex_candles_best_availability'::text,
    CASE 
      WHEN COUNT(*) > 100 THEN 'HEALTHY'
      WHEN COUNT(*) > 0 THEN 'LOW'
      ELSE 'NO_DATA'
    END::text,
    jsonb_build_object(
      'record_count', COUNT(*),
      'symbols', COUNT(DISTINCT symbol),
      'oldest_candle_age_hours', EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/3600
    )::jsonb,
    NOW()
  FROM forex_candles_best
  WHERE created_at > NOW() - INTERVAL '24 hours';

  -- Check 3: Session intelligence data freshness
  RETURN QUERY SELECT 
    'session_intelligence_data_freshness'::text,
    CASE 
      WHEN MAX(created_at) > NOW() - INTERVAL '5 minutes' THEN 'CURRENT'
      WHEN MAX(created_at) > NOW() - INTERVAL '30 minutes' THEN 'STALE'
      ELSE 'MISSING'
    END::text,
    jsonb_build_object(
      'record_count', COUNT(*),
      'non_expired_count', COUNT(CASE WHEN expires_at > NOW() THEN 1 END),
      'latest_record_age_minutes', EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/60
    )::jsonb,
    NOW()
  FROM session_intelligence_data;

  -- Check 4: RLS policies verification (fixed column name)
  RETURN QUERY SELECT 
    'rls_policies_completeness'::text,
    CASE WHEN COUNT(*) >= 5 THEN 'COMPLETE' ELSE 'INCOMPLETE' END::text,
    jsonb_agg(jsonb_build_object('policy', policyname))::jsonb,
    NOW()
  FROM pg_policies
  WHERE tablename = 'session_intelligence_data';

  -- Check 5: Function execution health
  RETURN QUERY SELECT 
    'function_execution_health'::text,
    CASE 
      WHEN MAX(CASE WHEN status = 'success' THEN created_at END) > NOW() - INTERVAL '10 minutes' THEN 'HEALTHY'
      WHEN MAX(CASE WHEN status = 'success' THEN created_at END) > NOW() - INTERVAL '30 minutes' THEN 'DEGRADED'
      ELSE 'UNHEALTHY'
    END::text,
    jsonb_build_object(
      'latest_success', MAX(CASE WHEN status = 'success' THEN created_at END),
      'recent_errors', COUNT(CASE WHEN status = 'error' AND created_at > NOW() - INTERVAL '30 minutes' THEN 1 END),
      'execution_avg_ms', ROUND(AVG(execution_time_ms))
    )::jsonb,
    NOW()
  FROM session_intelligence_logs
  WHERE created_at > NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION diagnose_session_intelligence_health() TO authenticated;
GRANT EXECUTE ON FUNCTION diagnose_session_intelligence_health() TO service_role;
