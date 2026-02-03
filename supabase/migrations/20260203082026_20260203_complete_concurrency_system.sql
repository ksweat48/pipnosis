/*
  # Complete Concurrency System Setup (CCIP-20260203-001)
  
  ## Purpose
  Create all missing tables and RPC functions for concurrent trade analysis.
  
  ## What's Included
  - All 4 core tables with proper indexes and RLS
  - All RPC functions for concurrency management
  - Cleanup utilities
  - Service role permissions
*/

-- 1. Create concurrency_limiter_state table if missing
CREATE TABLE IF NOT EXISTS concurrency_limiter_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  max_concurrent_trades INTEGER DEFAULT 5 NOT NULL,
  max_concurrent_checks_per_symbol INTEGER DEFAULT 2 NOT NULL,
  lock_timeout_seconds INTEGER DEFAULT 30 NOT NULL,
  
  is_circuit_broken BOOLEAN DEFAULT false NOT NULL,
  circuit_break_reason TEXT,
  circuit_break_triggered_at TIMESTAMPTZ,
  
  active_concurrent_count INTEGER DEFAULT 0 NOT NULL,
  avg_lock_wait_time_ms NUMERIC DEFAULT 0 NOT NULL,
  lock_contention_rate_percent NUMERIC DEFAULT 0 NOT NULL,
  
  last_recovery_at TIMESTAMPTZ,
  sequential_fallback_active BOOLEAN DEFAULT false NOT NULL,
  fallback_reason TEXT,
  
  CONSTRAINT concurrency_config_valid CHECK (
    max_concurrent_trades >= 1 AND max_concurrent_trades <= 100 AND
    lock_timeout_seconds >= 10 AND lock_timeout_seconds <= 300
  )
);

-- Create unique index on singleton table
CREATE UNIQUE INDEX IF NOT EXISTS idx_concurrency_limiter_singleton ON concurrency_limiter_state((1))
  WHERE id IS NOT NULL;

ALTER TABLE concurrency_limiter_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON concurrency_limiter_state;
CREATE POLICY "Service role only"
  ON concurrency_limiter_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Create lock_contention_metrics table if missing
CREATE TABLE IF NOT EXISTS lock_contention_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  trade_id UUID NOT NULL,
  lock_system TEXT NOT NULL,
  
  attempt_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  lock_acquired BOOLEAN NOT NULL,
  acquisition_wait_time_ms INTEGER NOT NULL,
  
  active_locks_at_attempt INTEGER NOT NULL,
  system_load_percent NUMERIC NOT NULL,
  
  decision_id TEXT,
  change_type TEXT DEFAULT 'lock_attempt' NOT NULL,
  
  CONSTRAINT contention_metrics_valid CHECK (
    acquisition_wait_time_ms >= 0 AND
    active_locks_at_attempt >= 0 AND
    system_load_percent >= 0 AND system_load_percent <= 100
  )
);

CREATE INDEX IF NOT EXISTS idx_contention_metrics_trade_id ON lock_contention_metrics(trade_id);
CREATE INDEX IF NOT EXISTS idx_contention_metrics_created_at ON lock_contention_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contention_by_system ON lock_contention_metrics(lock_system, created_at DESC);

ALTER TABLE lock_contention_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON lock_contention_metrics;
CREATE POLICY "Service role only"
  ON lock_contention_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Create concurrent_operation_tracking table if missing
CREATE TABLE IF NOT EXISTS concurrent_operation_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  trade_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  goal_session_id UUID,
  
  status TEXT DEFAULT 'started' NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  
  execution_order INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  
  execution_time_ms INTEGER,
  lock_wait_time_ms INTEGER DEFAULT 0,
  
  error_message TEXT,
  
  decision_id TEXT,
  
  CONSTRAINT operation_tracking_valid CHECK (
    status IN ('started', 'locked', 'processing', 'completed', 'failed', 'timeout') AND
    (execution_time_ms IS NULL OR execution_time_ms >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_concurrent_ops_trade_id ON concurrent_operation_tracking(trade_id);
CREATE INDEX IF NOT EXISTS idx_concurrent_ops_user_id ON concurrent_operation_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_concurrent_ops_batch_id ON concurrent_operation_tracking(batch_id);
CREATE INDEX IF NOT EXISTS idx_concurrent_ops_status ON concurrent_operation_tracking(status);
CREATE INDEX IF NOT EXISTS idx_concurrent_ops_created_at ON concurrent_operation_tracking(created_at DESC);

ALTER TABLE concurrent_operation_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON concurrent_operation_tracking;
CREATE POLICY "Service role only"
  ON concurrent_operation_tracking
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Create concurrency_circuit_breaker table if missing
CREATE TABLE IF NOT EXISTS concurrency_circuit_breaker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  state TEXT DEFAULT 'closed' NOT NULL,
  reason TEXT,
  
  contention_rate_at_trigger NUMERIC,
  lock_failures_at_trigger INTEGER,
  
  triggered_at TIMESTAMPTZ,
  recovery_start_at TIMESTAMPTZ,
  
  recovery_contention_threshold_percent NUMERIC DEFAULT 20 NOT NULL,
  recovery_lock_failure_threshold_percent NUMERIC DEFAULT 15 NOT NULL,
  recovery_duration_minutes INTEGER DEFAULT 5 NOT NULL,
  
  decision_id TEXT,
  
  CONSTRAINT circuit_breaker_valid CHECK (
    state IN ('closed', 'open', 'half_open', 'recovering') AND
    recovery_contention_threshold_percent > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_state ON concurrency_circuit_breaker(state);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_created_at ON concurrency_circuit_breaker(created_at DESC);

ALTER TABLE concurrency_circuit_breaker ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON concurrency_circuit_breaker;
CREATE POLICY "Service role only"
  ON concurrency_circuit_breaker
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. Function: Get current concurrency state
DROP FUNCTION IF EXISTS get_concurrency_state();
CREATE OR REPLACE FUNCTION get_concurrency_state()
RETURNS TABLE (
  max_concurrent_trades INTEGER,
  active_concurrent_count INTEGER,
  is_circuit_broken BOOLEAN,
  circuit_break_reason TEXT,
  lock_contention_rate_percent NUMERIC,
  sequential_fallback_active BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    cls.max_concurrent_trades,
    cls.active_concurrent_count,
    cls.is_circuit_broken,
    cls.circuit_break_reason,
    cls.lock_contention_rate_percent,
    cls.sequential_fallback_active
  FROM concurrency_limiter_state cls
  ORDER BY cls.updated_at DESC
  LIMIT 1;
END;
$$;

-- 6. Function: Record lock contention event
DROP FUNCTION IF EXISTS record_lock_contention(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, NUMERIC);
CREATE OR REPLACE FUNCTION record_lock_contention(
  p_trade_id UUID,
  p_lock_system TEXT,
  p_lock_acquired BOOLEAN,
  p_acquisition_wait_time_ms INTEGER,
  p_active_locks_at_attempt INTEGER,
  p_system_load_percent NUMERIC
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_metric_id UUID;
BEGIN
  INSERT INTO lock_contention_metrics (
    trade_id,
    lock_system,
    lock_acquired,
    acquisition_wait_time_ms,
    active_locks_at_attempt,
    system_load_percent,
    decision_id,
    change_type
  ) VALUES (
    p_trade_id,
    p_lock_system,
    p_lock_acquired,
    p_acquisition_wait_time_ms,
    p_active_locks_at_attempt,
    p_system_load_percent,
    gen_random_uuid()::text,
    'lock_attempt'
  ) RETURNING id INTO v_metric_id;

  RETURN v_metric_id;
END;
$$;

-- 7. Function: Cleanup old tracking data
DROP FUNCTION IF EXISTS cleanup_old_concurrency_data();
CREATE OR REPLACE FUNCTION cleanup_old_concurrency_data()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted_metrics INTEGER := 0;
  v_deleted_ops INTEGER := 0;
BEGIN
  DELETE FROM lock_contention_metrics
  WHERE created_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted_metrics = ROW_COUNT;

  DELETE FROM concurrent_operation_tracking
  WHERE completed_at < now() - INTERVAL '24 hours'
  AND status IN ('completed', 'failed', 'timeout');
  GET DIAGNOSTICS v_deleted_ops = ROW_COUNT;

  RETURN v_deleted_metrics + v_deleted_ops;
END;
$$;

-- 8. Grant execute permissions
GRANT EXECUTE ON FUNCTION get_concurrency_state TO authenticated, anon;
GRANT EXECUTE ON FUNCTION record_lock_contention TO authenticated, anon;
GRANT EXECUTE ON FUNCTION cleanup_old_concurrency_data TO authenticated, anon;

-- 9. Initialize concurrency state if empty
INSERT INTO concurrency_limiter_state (
  max_concurrent_trades,
  max_concurrent_checks_per_symbol,
  is_circuit_broken,
  sequential_fallback_active
) 
SELECT 5, 2, false, false
WHERE NOT EXISTS (SELECT 1 FROM concurrency_limiter_state);

-- 10. Initialize circuit breaker if empty
INSERT INTO concurrency_circuit_breaker (
  state,
  reason,
  recovery_contention_threshold_percent
) 
SELECT 'closed', 'Initialized - ready for concurrent operations', 20
WHERE NOT EXISTS (SELECT 1 FROM concurrency_circuit_breaker);
