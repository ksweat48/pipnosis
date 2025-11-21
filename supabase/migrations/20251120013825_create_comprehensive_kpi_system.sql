/*
  # Create Comprehensive KPI Monitoring System

  1. New Tables
    - `llm_layer_kpis` - Tracks 5-layer LLM decision stack performance
    - `avoid_pattern_kpis` - Monitors avoid pattern enforcement effectiveness
    - `continuous_learning_kpis` - Tracks learning loop health and metrics
    - `strategy_evolution_kpis` - Monitors pattern discovery and evolution
    - `smart_goal_kpis` - Tracks Smart Goal Mode performance
    - `ai_mastery_kpis` - Monitors AI skill progression and mastery
    - `kpi_anomalies` - Logs detected anomalies in KPI metrics
    - `kpi_cache` - Caching layer for frequently accessed KPIs

  2. Security
    - Enable RLS on all tables
    - Allow authenticated users to read their own KPI data
    - Allow system to insert/update KPI records

  3. Indexes
    - Add indexes for time-based queries
    - Add composite indexes for user and date filtering
*/

-- ============================================================================
-- TABLE 1: LLM Layer KPIs (5-Layer Decision Stack)
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_layer_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  layer_number integer NOT NULL CHECK (layer_number BETWEEN 0 AND 5),
  layer_name text NOT NULL,
  total_evaluations integer DEFAULT 0,
  pass_count integer DEFAULT 0,
  reject_count integer DEFAULT 0,
  skip_count integer DEFAULT 0,
  pass_rate numeric(5,2) DEFAULT 0,
  avg_confidence numeric(5,2) DEFAULT 0,
  total_tokens_used integer DEFAULT 0,
  avg_processing_time_ms integer DEFAULT 0,
  rejection_reasons jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date, layer_number)
);

CREATE INDEX idx_llm_layer_kpis_user_date ON llm_layer_kpis(user_id, date DESC);
CREATE INDEX idx_llm_layer_kpis_layer ON llm_layer_kpis(layer_number);

ALTER TABLE llm_layer_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own LLM layer KPIs"
  ON llm_layer_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own LLM layer KPIs"
  ON llm_layer_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own LLM layer KPIs"
  ON llm_layer_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 2: Avoid Pattern KPIs
-- ============================================================================

CREATE TABLE IF NOT EXISTS avoid_pattern_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  symbol text NOT NULL,
  total_checks integer DEFAULT 0,
  trades_avoided integer DEFAULT 0,
  trades_allowed integer DEFAULT 0,
  block_rate numeric(5,2) DEFAULT 0,
  avg_similarity_score numeric(5,2) DEFAULT 0,
  patterns_matched integer DEFAULT 0,
  pattern_accuracy numeric(5,2) DEFAULT 0,
  ev_of_avoided_trades numeric(10,2) DEFAULT 0,
  ev_of_taken_trades numeric(10,2) DEFAULT 0,
  ev_difference numeric(10,2) DEFAULT 0,
  pattern_conflicts integer DEFAULT 0,
  false_positive_rate numeric(5,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date, symbol)
);

CREATE INDEX idx_avoid_pattern_kpis_user_date ON avoid_pattern_kpis(user_id, date DESC);
CREATE INDEX idx_avoid_pattern_kpis_symbol ON avoid_pattern_kpis(symbol);

ALTER TABLE avoid_pattern_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own avoid pattern KPIs"
  ON avoid_pattern_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own avoid pattern KPIs"
  ON avoid_pattern_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own avoid pattern KPIs"
  ON avoid_pattern_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 3: Continuous Learning Loop KPIs
-- ============================================================================

CREATE TABLE IF NOT EXISTS continuous_learning_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  loop_activations integer DEFAULT 0,
  insights_validated integer DEFAULT 0,
  insights_updated integer DEFAULT 0,
  insights_pruned integer DEFAULT 0,
  insights_created integer DEFAULT 0,
  validation_accuracy numeric(5,2) DEFAULT 0,
  confidence_recalibrations integer DEFAULT 0,
  avg_confidence_adjustment numeric(5,2) DEFAULT 0,
  rolling_css numeric(5,2) DEFAULT 0,
  learning_velocity numeric(5,2) DEFAULT 0,
  system_health_score numeric(5,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_continuous_learning_kpis_user_date ON continuous_learning_kpis(user_id, date DESC);

ALTER TABLE continuous_learning_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learning KPIs"
  ON continuous_learning_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learning KPIs"
  ON continuous_learning_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own learning KPIs"
  ON continuous_learning_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 4: Strategy Evolution KPIs
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_evolution_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  symbol text NOT NULL,
  patterns_discovered integer DEFAULT 0,
  patterns_active integer DEFAULT 0,
  patterns_deactivated integer DEFAULT 0,
  avg_pattern_ev numeric(10,2) DEFAULT 0,
  pattern_ev_stability numeric(5,2) DEFAULT 0,
  cross_symbol_generalization numeric(5,2) DEFAULT 0,
  pattern_survival_rate numeric(5,2) DEFAULT 0,
  avg_pattern_lifespan_days integer DEFAULT 0,
  top_pattern_name text,
  top_pattern_ev numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date, symbol)
);

CREATE INDEX idx_strategy_evolution_kpis_user_date ON strategy_evolution_kpis(user_id, date DESC);
CREATE INDEX idx_strategy_evolution_kpis_symbol ON strategy_evolution_kpis(symbol);

ALTER TABLE strategy_evolution_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategy evolution KPIs"
  ON strategy_evolution_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strategy evolution KPIs"
  ON strategy_evolution_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategy evolution KPIs"
  ON strategy_evolution_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 5: Smart Goal Mode KPIs
-- ============================================================================

CREATE TABLE IF NOT EXISTS smart_goal_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  total_trades integer DEFAULT 0,
  llm_decision_trades integer DEFAULT 0,
  rule_based_trades integer DEFAULT 0,
  llm_decision_percentage numeric(5,2) DEFAULT 0,
  llm_win_rate numeric(5,2) DEFAULT 0,
  rule_win_rate numeric(5,2) DEFAULT 0,
  performance_gap numeric(5,2) DEFAULT 0,
  goals_completed integer DEFAULT 0,
  goals_active integer DEFAULT 0,
  avg_trades_per_goal numeric(5,2) DEFAULT 0,
  avg_time_per_goal_minutes integer DEFAULT 0,
  goal_completion_efficiency numeric(5,2) DEFAULT 0,
  risk_efficiency_score numeric(5,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_smart_goal_kpis_user_date ON smart_goal_kpis(user_id, date DESC);

ALTER TABLE smart_goal_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own smart goal KPIs"
  ON smart_goal_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own smart goal KPIs"
  ON smart_goal_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own smart goal KPIs"
  ON smart_goal_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 6: AI Mastery KPIs
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_mastery_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  moving_win_rate_50 numeric(5,2) DEFAULT 0,
  moving_win_rate_100 numeric(5,2) DEFAULT 0,
  moving_win_rate_500 numeric(5,2) DEFAULT 0,
  moving_profit_factor_50 numeric(5,2) DEFAULT 0,
  moving_profit_factor_100 numeric(5,2) DEFAULT 0,
  moving_profit_factor_500 numeric(5,2) DEFAULT 0,
  mistake_reduction_rate numeric(5,2) DEFAULT 0,
  confidence_accuracy numeric(5,2) DEFAULT 0,
  pattern_generalization_index numeric(5,2) DEFAULT 0,
  reaction_time_improvement numeric(5,2) DEFAULT 0,
  skill_level text,
  skill_progress_percentage numeric(5,2) DEFAULT 0,
  trades_to_next_level integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_ai_mastery_kpis_user_date ON ai_mastery_kpis(user_id, date DESC);

ALTER TABLE ai_mastery_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mastery KPIs"
  ON ai_mastery_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mastery KPIs"
  ON ai_mastery_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mastery KPIs"
  ON ai_mastery_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 7: KPI Anomalies
-- ============================================================================

CREATE TABLE IF NOT EXISTS kpi_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  kpi_table text NOT NULL,
  kpi_metric text NOT NULL,
  expected_range_min numeric(10,2),
  expected_range_max numeric(10,2),
  actual_value numeric(10,2) NOT NULL,
  severity text CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  anomaly_reason text,
  recovery_suggestion text,
  detected_at timestamptz DEFAULT now(),
  acknowledged boolean DEFAULT false,
  acknowledged_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_kpi_anomalies_user ON kpi_anomalies(user_id);
CREATE INDEX idx_kpi_anomalies_detected ON kpi_anomalies(detected_at DESC);
CREATE INDEX idx_kpi_anomalies_acknowledged ON kpi_anomalies(acknowledged);

ALTER TABLE kpi_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own anomalies"
  ON kpi_anomalies FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own anomalies"
  ON kpi_anomalies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own anomalies"
  ON kpi_anomalies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 8: KPI Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS kpi_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  cache_key text NOT NULL,
  cache_value jsonb NOT NULL,
  ttl_seconds integer DEFAULT 300,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, cache_key)
);

CREATE INDEX idx_kpi_cache_user_key ON kpi_cache(user_id, cache_key);
CREATE INDEX idx_kpi_cache_expires ON kpi_cache(expires_at);

ALTER TABLE kpi_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cache"
  ON kpi_cache FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own cache"
  ON kpi_cache FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION clean_expired_kpi_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM kpi_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate moving average win rate
CREATE OR REPLACE FUNCTION calculate_moving_win_rate(
  p_user_id uuid,
  p_trade_count integer
)
RETURNS numeric AS $$
DECLARE
  v_win_rate numeric;
BEGIN
  SELECT
    CASE
      WHEN COUNT(*) >= p_trade_count THEN
        (COUNT(*) FILTER (WHERE outcome = 'win')::numeric / p_trade_count::numeric) * 100
      ELSE 0
    END INTO v_win_rate
  FROM (
    SELECT outcome
    FROM ai_trade_analysis
    WHERE user_id = p_user_id
    ORDER BY entry_time DESC
    LIMIT p_trade_count
  ) recent_trades;

  RETURN COALESCE(v_win_rate, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate moving profit factor
CREATE OR REPLACE FUNCTION calculate_moving_profit_factor(
  p_user_id uuid,
  p_trade_count integer
)
RETURNS numeric AS $$
DECLARE
  v_total_wins numeric;
  v_total_losses numeric;
  v_profit_factor numeric;
BEGIN
  SELECT
    SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END),
    SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END)
  INTO v_total_wins, v_total_losses
  FROM (
    SELECT pnl
    FROM ai_trade_analysis
    WHERE user_id = p_user_id
    ORDER BY entry_time DESC
    LIMIT p_trade_count
  ) recent_trades;

  IF v_total_losses > 0 THEN
    v_profit_factor := v_total_wins / v_total_losses;
  ELSE
    v_profit_factor := v_total_wins;
  END IF;

  RETURN COALESCE(v_profit_factor, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;