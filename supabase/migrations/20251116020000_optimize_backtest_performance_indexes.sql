/*
  # Optimize Backtest Performance with Strategic Indexes

  1. Purpose
    - Add strategic indexes to heavily-queried backtest tables
    - Improve query performance for AI training workloads
    - Reduce database I/O and CPU usage during backtests
    - Optimize for Supabase Pro tier resource limits

  2. New Indexes
    - `synthetic_backtest_sessions`: status, user_id, created_at queries
    - `synthetic_backtest_trades`: session lookups, outcome filtering
    - `ai_learning_insights`: user and session queries
    - `ai_trade_analysis`: user queries with outcome filtering
    - `ai_performance_evolution`: user timeline queries
    - `ai_skill_tracking`: user progression queries

  3. Performance Impact
    - Reduces full table scans for dashboard queries
    - Speeds up backtest result aggregation
    - Improves AI learning data retrieval
    - Enables efficient time-range queries

  4. Notes
    - Uses partial indexes where appropriate to save space
    - Composite indexes for multi-column queries
    - CONCURRENTLY option to avoid blocking production traffic
*/

-- Optimize synthetic_backtest_sessions queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_sessions_user_status_created
  ON synthetic_backtest_sessions(user_id, status, created_at DESC)
  WHERE status IN ('completed', 'running');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_sessions_completed_at
  ON synthetic_backtest_sessions(user_id, completed_at DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_sessions_generation_id
  ON synthetic_backtest_sessions(synthetic_generation_id)
  WHERE synthetic_generation_id IS NOT NULL;

-- Optimize synthetic_backtest_trades queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_trades_session_outcome
  ON synthetic_backtest_trades(session_id, outcome)
  WHERE outcome IN ('win', 'loss');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_trades_user_created
  ON synthetic_backtest_trades(user_id, entry_time DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_trades_symbol_outcome
  ON synthetic_backtest_trades(symbol, outcome, entry_time DESC)
  WHERE outcome IN ('win', 'loss');

-- Optimize ai_learning_insights queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_insights_user_created
  ON ai_learning_insights(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_insights_synthetic_session
  ON ai_learning_insights(synthetic_session_id, created_at DESC)
  WHERE synthetic_session_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_insights_pattern_category
  ON ai_learning_insights(pattern_category, created_at DESC)
  WHERE pattern_category IS NOT NULL;

-- Optimize ai_trade_analysis queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_trade_analysis_user_created
  ON ai_trade_analysis(user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_trade_analysis_outcome
  ON ai_trade_analysis(user_id, predicted_outcome, created_at DESC)
  WHERE predicted_outcome IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_trade_analysis_synthetic
  ON ai_trade_analysis(synthetic_trade_id)
  WHERE synthetic_trade_id IS NOT NULL;

-- Optimize ai_performance_evolution queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_performance_user_updated
  ON ai_performance_evolution(user_id, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_performance_skill_level
  ON ai_performance_evolution(user_id, skill_level DESC, updated_at DESC);

-- Optimize ai_skill_tracking queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_skill_tracking_user_updated
  ON ai_skill_tracking(user_id, updated_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_skill_tracking_progression
  ON ai_skill_tracking(user_id, skill_level DESC, trades_processed DESC);

-- Optimize auto_backtest_global_state queries (lightweight table)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auto_backtest_state_running
  ON auto_backtest_global_state(user_id, is_running, last_heartbeat DESC)
  WHERE is_running = true;

-- Add comment explaining optimization strategy
COMMENT ON INDEX idx_synthetic_sessions_user_status_created IS
  'Optimizes dashboard queries for user backtest sessions by status and recency';

COMMENT ON INDEX idx_synthetic_trades_session_outcome IS
  'Speeds up win/loss aggregation for backtest result calculations';

COMMENT ON INDEX idx_ai_insights_user_created IS
  'Improves AI learning dashboard performance for recent insights retrieval';

COMMENT ON INDEX idx_ai_trade_analysis_user_created IS
  'Optimizes AI trade analysis queries by user and time range';

COMMENT ON INDEX idx_ai_performance_user_updated IS
  'Enhances performance tracking timeline queries';

COMMENT ON INDEX idx_ai_skill_tracking_user_updated IS
  'Accelerates skill progression monitoring queries';
