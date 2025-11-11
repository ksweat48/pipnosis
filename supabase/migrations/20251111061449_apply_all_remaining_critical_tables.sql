-- ============================================================================
-- COMPLETE REMAINING MIGRATIONS - SYSTEMATIC APPLICATION
-- ============================================================================

-- Missing from KPI system
CREATE TABLE IF NOT EXISTS ai_strategy_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid,
  strategy_type text NOT NULL,
  symbol text NOT NULL,
  timeframe text,
  trade_direction text CHECK (trade_direction IN ('buy', 'sell')),
  entry_price decimal(15,5),
  exit_price decimal(15,5),
  lot_size decimal(10,2),
  profit_loss decimal(15,2) NOT NULL,
  is_win boolean NOT NULL,
  ai_confidence text CHECK (ai_confidence IN ('high', 'medium', 'low')),
  market_condition text,
  entry_reason text,
  exit_reason text,
  trade_duration_minutes integer,
  executed_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_type text NOT NULL UNIQUE,
  total_trades integer DEFAULT 0,
  win_count integer DEFAULT 0,
  loss_count integer DEFAULT 0,
  win_rate decimal(5,2) DEFAULT 0.00,
  total_profit decimal(15,2) DEFAULT 0.00,
  total_loss decimal(15,2) DEFAULT 0.00,
  net_profit decimal(15,2) DEFAULT 0.00,
  average_win_size decimal(15,2) DEFAULT 0.00,
  average_loss_size decimal(15,2) DEFAULT 0.00,
  largest_win decimal(15,2) DEFAULT 0.00,
  largest_loss decimal(15,2) DEFAULT 0.00,
  profit_factor decimal(10,2) DEFAULT 0.00,
  risk_reward_ratio decimal(10,2) DEFAULT 0.00,
  average_trade_duration integer DEFAULT 0,
  best_symbol text,
  best_timeframe text,
  last_updated timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_performance_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE UNIQUE,
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate decimal(5,2) DEFAULT 0.00,
  total_profit decimal(15,2) DEFAULT 0.00,
  total_loss decimal(15,2) DEFAULT 0.00,
  net_profit decimal(15,2) DEFAULT 0.00,
  best_strategy text,
  favorite_symbol text,
  average_trade_duration integer DEFAULT 0,
  last_trade_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_training_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_name text NOT NULL,
  description text,
  market_condition text,
  volatility_level text,
  trend_type text,
  symbols text[],
  timeframes text[],
  expected_outcome text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pattern_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_name text NOT NULL,
  pattern_type text,
  symbols text[],
  confidence_score numeric(5,2),
  success_rate numeric(5,2),
  total_occurrences integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_discovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name text NOT NULL,
  strategy_type text,
  discovery_method text,
  confidence_score numeric(5,2),
  backtested boolean DEFAULT false,
  live_tested boolean DEFAULT false,
  performance_metrics jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auto_backtest_controller (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_name text NOT NULL,
  status text DEFAULT 'pending',
  strategy_id uuid,
  start_date timestamptz,
  end_date timestamptz,
  symbols text[],
  results jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE ai_strategy_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_performance_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_training_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_discovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_backtest_controller ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users view strategy performance" ON ai_strategy_performance;
CREATE POLICY "Authenticated users view strategy performance"
  ON ai_strategy_performance FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System can insert strategy performance" ON ai_strategy_performance;
CREATE POLICY "System can insert strategy performance"
  ON ai_strategy_performance FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view analytics" ON strategy_analytics;
CREATE POLICY "Authenticated users view analytics"
  ON strategy_analytics FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System manages analytics" ON strategy_analytics;
CREATE POLICY "System manages analytics"
  ON strategy_analytics FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users view own performance" ON user_performance_summary;
CREATE POLICY "Users view own performance"
  ON user_performance_summary FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System manages performance" ON user_performance_summary;
CREATE POLICY "System manages performance"
  ON user_performance_summary FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view scenarios" ON ai_training_scenarios;
CREATE POLICY "Authenticated users view scenarios"
  ON ai_training_scenarios FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System manages scenarios" ON ai_training_scenarios;
CREATE POLICY "System manages scenarios"
  ON ai_training_scenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view clusters" ON pattern_clusters;
CREATE POLICY "Authenticated users view clusters"
  ON pattern_clusters FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System manages clusters" ON pattern_clusters;
CREATE POLICY "System manages clusters"
  ON pattern_clusters FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view discovery" ON strategy_discovery;
CREATE POLICY "Authenticated users view discovery"
  ON strategy_discovery FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System manages discovery" ON strategy_discovery;
CREATE POLICY "System manages discovery"
  ON strategy_discovery FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users view backtests" ON auto_backtest_controller;
CREATE POLICY "Authenticated users view backtests"
  ON auto_backtest_controller FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "System manages backtests" ON auto_backtest_controller;
CREATE POLICY "System manages backtests"
  ON auto_backtest_controller FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_strategy_perf_user_id ON ai_strategy_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_executed_at ON ai_strategy_performance(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_perf_user_id ON user_performance_summary(user_id);
CREATE INDEX IF NOT EXISTS idx_pattern_clusters_name ON pattern_clusters(cluster_name);
CREATE INDEX IF NOT EXISTS idx_strategy_discovery_name ON strategy_discovery(strategy_name);
CREATE INDEX IF NOT EXISTS idx_backtest_status ON auto_backtest_controller(status, created_at DESC);
