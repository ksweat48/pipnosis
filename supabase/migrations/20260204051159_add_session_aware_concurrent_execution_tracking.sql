/*
  # Add Session-Aware Concurrent Execution Tracking

  ## Summary
  Enhances concurrent execution analytics with market session awareness.
  Tracks which market session (Asian, London, NYSE, Overlap) was active during
  each concurrent batch execution to correlate performance with market complexity.

  ## Changes

  1. **Schema Modifications**
     - Add `market_session` column to `concurrent_execution_sessions`
     - Add `session_timeout_ms` column to track session-specific timeout used
     - Add indexes for session-based analytics queries

  2. **Analytics Functions**
     - Add `get_session_performance_stats()` - performance breakdown by session
     - Add `get_session_timeout_effectiveness()` - timeout effectiveness by session

  3. **Governance**
     - Session-based performance monitoring
     - Timeout optimization metrics per session

  ## Why This Matters
  Different market sessions have different complexity levels:
  - Asian: Lower volatility → faster analysis expected
  - London: Moderate complexity
  - NYSE: High activity
  - Overlap: Highest complexity → longer analysis justified
  - Off-hours: Limited activity → fast rejections expected

  Tracking session correlation enables optimization of timeout thresholds
  and early detection of session-specific performance issues.
*/

-- Add session tracking columns to concurrent_execution_sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'concurrent_execution_sessions'
    AND column_name = 'market_session'
  ) THEN
    ALTER TABLE concurrent_execution_sessions
    ADD COLUMN market_session text;

    COMMENT ON COLUMN concurrent_execution_sessions.market_session IS 
      'Market session during execution: asian, london, nyse, overlap, off_hours';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'concurrent_execution_sessions'
    AND column_name = 'session_timeout_ms'
  ) THEN
    ALTER TABLE concurrent_execution_sessions
    ADD COLUMN session_timeout_ms integer;

    COMMENT ON COLUMN concurrent_execution_sessions.session_timeout_ms IS 
      'Session-specific timeout used for this batch (ms)';
  END IF;
END $$;

-- Add check constraint for valid market sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_market_session'
  ) THEN
    ALTER TABLE concurrent_execution_sessions
    ADD CONSTRAINT valid_market_session 
    CHECK (market_session IN ('asian', 'london', 'nyse', 'overlap', 'off_hours') OR market_session IS NULL);
  END IF;
END $$;

-- Add index for session-based analytics
CREATE INDEX IF NOT EXISTS idx_concurrent_sessions_market_session 
ON concurrent_execution_sessions(market_session, created_at DESC);

-- Add index for session timeout analysis
CREATE INDEX IF NOT EXISTS idx_concurrent_sessions_session_performance 
ON concurrent_execution_sessions(market_session, duration_ms);

-- Create analytics function: Session performance stats
CREATE OR REPLACE FUNCTION get_session_performance_stats(
  days_back integer DEFAULT 7
)
RETURNS TABLE (
  market_session text,
  total_batches bigint,
  avg_duration_ms numeric,
  avg_symbols_evaluated numeric,
  avg_success_rate numeric,
  avg_timeout_ms numeric,
  timeout_hit_rate numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    ces.market_session,
    COUNT(*)::bigint as total_batches,
    ROUND(AVG(ces.duration_ms), 2) as avg_duration_ms,
    ROUND(AVG(ces.evaluated_symbols::numeric), 2) as avg_symbols_evaluated,
    ROUND(AVG(CASE 
      WHEN ces.total_symbols > 0 
      THEN (ces.evaluated_symbols::numeric / ces.total_symbols::numeric * 100)
      ELSE 0
    END), 2) as avg_success_rate,
    ROUND(AVG(ces.session_timeout_ms::numeric), 2) as avg_timeout_ms,
    ROUND(AVG(CASE 
      WHEN ces.duration_ms >= ces.session_timeout_ms
      THEN 1.0
      ELSE 0.0
    END) * 100, 2) as timeout_hit_rate
  FROM concurrent_execution_sessions ces
  WHERE ces.created_at >= NOW() - (days_back || ' days')::interval
    AND ces.market_session IS NOT NULL
  GROUP BY ces.market_session
  ORDER BY total_batches DESC;
END;
$$;

COMMENT ON FUNCTION get_session_performance_stats IS 
  'Analytics: Performance breakdown by market session for timeout optimization';

-- Create analytics function: Session timeout effectiveness
CREATE OR REPLACE FUNCTION get_session_timeout_effectiveness(
  target_session text DEFAULT NULL,
  days_back integer DEFAULT 7
)
RETURNS TABLE (
  market_session text,
  configured_timeout_ms integer,
  avg_actual_duration_ms numeric,
  p50_duration_ms numeric,
  p95_duration_ms numeric,
  max_duration_ms integer,
  timeout_utilization_pct numeric,
  recommendation text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH session_stats AS (
    SELECT
      ces.market_session,
      ces.session_timeout_ms,
      ces.duration_ms,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ces.duration_ms) 
        OVER (PARTITION BY ces.market_session) as p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ces.duration_ms) 
        OVER (PARTITION BY ces.market_session) as p95
    FROM concurrent_execution_sessions ces
    WHERE ces.created_at >= NOW() - (days_back || ' days')::interval
      AND ces.market_session IS NOT NULL
      AND (target_session IS NULL OR ces.market_session = target_session)
  )
  SELECT DISTINCT
    ss.market_session,
    ss.session_timeout_ms as configured_timeout_ms,
    ROUND(AVG(ss.duration_ms) OVER (PARTITION BY ss.market_session), 2) as avg_actual_duration_ms,
    ROUND(ss.p50, 2) as p50_duration_ms,
    ROUND(ss.p95, 2) as p95_duration_ms,
    MAX(ss.duration_ms) OVER (PARTITION BY ss.market_session)::integer as max_duration_ms,
    ROUND((AVG(ss.duration_ms) OVER (PARTITION BY ss.market_session) / 
           ss.session_timeout_ms::numeric * 100), 2) as timeout_utilization_pct,
    CASE
      WHEN AVG(ss.duration_ms) OVER (PARTITION BY ss.market_session) > ss.session_timeout_ms * 0.9
      THEN 'INCREASE: Timeout too tight (>90% utilization)'
      WHEN AVG(ss.duration_ms) OVER (PARTITION BY ss.market_session) < ss.session_timeout_ms * 0.5
      THEN 'DECREASE: Timeout too generous (<50% utilization)'
      ELSE 'OPTIMAL: Timeout properly configured'
    END as recommendation
  FROM session_stats ss
  ORDER BY ss.market_session;
END;
$$;

COMMENT ON FUNCTION get_session_timeout_effectiveness IS 
  'Analytics: Evaluate timeout effectiveness by market session with recommendations';

-- Grant permissions
GRANT SELECT ON concurrent_execution_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_performance_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_timeout_effectiveness TO authenticated;
