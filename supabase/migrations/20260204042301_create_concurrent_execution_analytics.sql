/*
  # Create Concurrent Symbol Execution Analytics System

  ## Purpose
  Track Alpha's concurrent symbol analysis performance for optimization and governance.

  ## Tables Created
  1. `concurrent_execution_sessions`
     - Tracks each batch of concurrent symbol evaluations
     - Records execution mode (concurrent vs sequential)
     - Tracks timing, error rates, and early-exit effectiveness
     - Governance and CCIP audit trail

  2. `concurrent_symbol_timings`
     - Per-symbol execution details
     - Tracks decision quality, timing, and errors
     - Links to parent execution session

  ## SSOT Compliance
  - Single source of truth for concurrent execution metrics
  - All concurrent execution tracking references these tables
  - Configuration changes tracked via execution_config_snapshot

  ## CCIP Compliance
  - Full audit trail of all concurrent executions
  - Configuration snapshots for change tracking
  - Error tracking for governance alerts

  ## Governance
  - Performance monitoring for optimization
  - Error rate tracking for alerting
  - Early-exit effectiveness analysis
  - LLM cost savings measurement

  ## Security
  - RLS enabled on all tables
  - Users can only read their own execution data
  - Service role has full access for system monitoring
  - Admin access for governance oversight
*/

-- =====================================================
-- TABLE: concurrent_execution_sessions
-- =====================================================
CREATE TABLE IF NOT EXISTS concurrent_execution_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Execution metadata
  execution_id text NOT NULL UNIQUE,
  execution_mode text NOT NULL CHECK (execution_mode IN ('CONCURRENT', 'SEQUENTIAL')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,

  -- Symbol analysis details
  total_symbols integer NOT NULL,
  evaluated_symbols integer NOT NULL,
  skipped_symbols integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_rate_percent numeric(5,2),

  -- Early-exit optimization
  early_exit_enabled boolean NOT NULL DEFAULT false,
  early_exit_triggered boolean NOT NULL DEFAULT false,
  early_exit_symbol text,
  early_exit_confidence numeric(5,2),
  symbols_saved_by_early_exit integer DEFAULT 0,

  -- Performance metrics
  avg_symbol_duration_ms numeric(10,2),
  min_symbol_duration_ms integer,
  max_symbol_duration_ms integer,

  -- LLM cost tracking
  estimated_llm_calls_total integer,
  estimated_llm_calls_avoided integer DEFAULT 0,

  -- Configuration snapshot (CCIP audit)
  execution_config_snapshot jsonb,

  -- Goal session context
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  min_confidence_threshold numeric(5,2),

  -- Governance flags
  exceeded_timeout_threshold boolean DEFAULT false,
  exceeded_error_threshold boolean DEFAULT false,
  governance_alert_triggered boolean DEFAULT false,

  -- Audit trail
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- TABLE: concurrent_symbol_timings
-- =====================================================
CREATE TABLE IF NOT EXISTS concurrent_symbol_timings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES concurrent_execution_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Symbol details
  symbol text NOT NULL,
  evaluation_index integer NOT NULL, -- Order in which symbol was processed

  -- Timing
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms integer,
  timed_out boolean DEFAULT false,

  -- Decision outcome
  decision_action text NOT NULL CHECK (decision_action IN ('BUY', 'SELL', 'NO_TRADE', 'WAIT', 'ERROR')),
  confidence numeric(5,2),
  was_viable_trade boolean DEFAULT false,
  triggered_early_exit boolean DEFAULT false,

  -- Error tracking
  had_error boolean DEFAULT false,
  error_message text,
  error_type text, -- 'timeout', 'atr_invalid', 'system_error', etc.

  -- Market state snapshot (for analysis)
  price numeric(20,8),
  atr numeric(20,8),
  volatility text,

  -- Audit trail
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- INDEXES for Performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_concurrent_execution_sessions_user_id
  ON concurrent_execution_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_concurrent_execution_sessions_started_at
  ON concurrent_execution_sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_concurrent_execution_sessions_execution_mode
  ON concurrent_execution_sessions(execution_mode);

CREATE INDEX IF NOT EXISTS idx_concurrent_execution_sessions_early_exit
  ON concurrent_execution_sessions(early_exit_triggered)
  WHERE early_exit_triggered = true;

CREATE INDEX IF NOT EXISTS idx_concurrent_execution_sessions_goal_session
  ON concurrent_execution_sessions(goal_session_id)
  WHERE goal_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_concurrent_symbol_timings_session_id
  ON concurrent_symbol_timings(session_id);

CREATE INDEX IF NOT EXISTS idx_concurrent_symbol_timings_symbol
  ON concurrent_symbol_timings(symbol);

CREATE INDEX IF NOT EXISTS idx_concurrent_symbol_timings_viable_trades
  ON concurrent_symbol_timings(was_viable_trade)
  WHERE was_viable_trade = true;

-- =====================================================
-- RLS Policies
-- =====================================================
ALTER TABLE concurrent_execution_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE concurrent_symbol_timings ENABLE ROW LEVEL SECURITY;

-- Users can read their own execution data
CREATE POLICY "Users can view own execution sessions"
  ON concurrent_execution_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own symbol timings"
  ON concurrent_symbol_timings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can insert execution data
CREATE POLICY "Service role can insert execution sessions"
  ON concurrent_execution_sessions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update execution sessions"
  ON concurrent_execution_sessions
  FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert symbol timings"
  ON concurrent_symbol_timings
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admins can view all execution data (governance oversight)
CREATE POLICY "Admins can view all execution sessions"
  ON concurrent_execution_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can view all symbol timings"
  ON concurrent_symbol_timings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- =====================================================
-- HELPER FUNCTIONS for Analytics
-- =====================================================

-- Calculate average concurrent execution performance
CREATE OR REPLACE FUNCTION get_concurrent_execution_stats(
  p_user_id uuid DEFAULT NULL,
  p_days integer DEFAULT 7
)
RETURNS TABLE (
  total_sessions bigint,
  concurrent_sessions bigint,
  sequential_sessions bigint,
  avg_duration_ms numeric,
  avg_symbols_per_session numeric,
  avg_error_rate numeric,
  early_exit_effectiveness numeric,
  total_llm_calls_saved bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_sessions,
    COUNT(*) FILTER (WHERE execution_mode = 'CONCURRENT')::bigint as concurrent_sessions,
    COUNT(*) FILTER (WHERE execution_mode = 'SEQUENTIAL')::bigint as sequential_sessions,
    AVG(duration_ms)::numeric as avg_duration_ms,
    AVG(evaluated_symbols)::numeric as avg_symbols_per_session,
    AVG(error_rate_percent)::numeric as avg_error_rate,
    (AVG(symbols_saved_by_early_exit)::numeric / NULLIF(AVG(total_symbols), 0) * 100) as early_exit_effectiveness,
    SUM(estimated_llm_calls_avoided)::bigint as total_llm_calls_saved
  FROM concurrent_execution_sessions
  WHERE (p_user_id IS NULL OR user_id = p_user_id)
    AND started_at >= now() - (p_days || ' days')::interval;
END;
$$;

-- Get most analyzed symbols (for optimization)
CREATE OR REPLACE FUNCTION get_most_analyzed_symbols(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  symbol text,
  analysis_count bigint,
  viable_trade_count bigint,
  viable_trade_rate numeric,
  avg_confidence numeric,
  avg_duration_ms numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cst.symbol,
    COUNT(*)::bigint as analysis_count,
    COUNT(*) FILTER (WHERE was_viable_trade = true)::bigint as viable_trade_count,
    (COUNT(*) FILTER (WHERE was_viable_trade = true)::numeric / COUNT(*) * 100) as viable_trade_rate,
    AVG(confidence)::numeric as avg_confidence,
    AVG(duration_ms)::numeric as avg_duration_ms
  FROM concurrent_symbol_timings cst
  WHERE (p_user_id IS NULL OR cst.user_id = p_user_id)
    AND cst.created_at >= now() - interval '30 days'
  GROUP BY cst.symbol
  ORDER BY analysis_count DESC
  LIMIT p_limit;
END;
$$;

-- =====================================================
-- COMMENTS for Documentation
-- =====================================================
COMMENT ON TABLE concurrent_execution_sessions IS
'SSOT for tracking Alpha concurrent symbol analysis sessions. Used for performance monitoring, governance, and CCIP audit.';

COMMENT ON TABLE concurrent_symbol_timings IS
'Per-symbol execution details for concurrent analysis. Links to parent session for aggregate metrics.';

COMMENT ON COLUMN concurrent_execution_sessions.execution_config_snapshot IS
'CCIP: Snapshot of concurrent-execution-config at time of execution. Tracks configuration changes over time.';

COMMENT ON COLUMN concurrent_execution_sessions.early_exit_triggered IS
'TRUE if early-exit optimization stopped analysis after finding viable trade. Used to measure optimization effectiveness.';

COMMENT ON COLUMN concurrent_execution_sessions.estimated_llm_calls_avoided IS
'Estimated LLM calls saved by early-exit optimization. Used for cost-benefit analysis.';