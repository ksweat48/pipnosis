/*
  # AI Learning System Schema

  ## Overview
  Comprehensive AI learning and improvement system that stores insights, patterns,
  and performance evolution from all backtests (synthetic and real). The AI uses
  this data to continuously improve trading decisions.

  ## New Tables

  ### 1. `ai_learning_insights` - Extracted patterns and lessons from backtests
  - Stores what works and what doesn't in different market conditions
  - Tracks optimal entry/exit patterns by symbol and timeframe
  - Records confidence level improvements over time

  ### 2. `ai_trade_analysis` - Detailed post-trade analysis
  - Deep dive into why each trade won or lost
  - Market condition analysis at entry and exit
  - Pattern matching with historical similar trades

  ### 3. `ai_performance_evolution` - Tracks AI improvement over time
  - Win rate progression by symbol and market condition
  - Confidence threshold optimization history
  - Performance metrics before/after learning adjustments

  ### 4. `ai_decision_feedback` - Real-time decision quality tracking
  - Records AI reasoning for each trade decision
  - Stores outcome and whether decision was optimal
  - Builds confidence scoring for similar future scenarios

  ### 5. `ai_market_scenario_performance` - Performance by market type
  - Win rates in trending vs ranging markets
  - Performance in high/low volatility conditions
  - Best strategies for each market scenario

  ## Security
  - Admin and authenticated user access via RLS
  - All tables link to user_id for data isolation
*/

-- ============================================================================
-- TABLE 1: AI LEARNING INSIGHTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source Information
  backtest_session_id uuid REFERENCES backtest_sessions(id) ON DELETE CASCADE,
  synthetic_session_id uuid REFERENCES synthetic_backtest_sessions(id) ON DELETE CASCADE,
  is_from_live_trading boolean DEFAULT false,

  -- Pattern Identification
  insight_type text NOT NULL CHECK (insight_type IN ('winning_pattern', 'losing_pattern', 'optimal_timing', 'risk_management', 'market_condition', 'strategy_preference')),
  symbol text NOT NULL,
  timeframe text NOT NULL,

  -- Market Context
  market_scenario text NOT NULL,
  volatility_level text NOT NULL,
  trend_direction text NOT NULL,

  -- The Insight
  insight_title text NOT NULL,
  insight_description text NOT NULL,
  pattern_features jsonb NOT NULL,

  -- Performance Metrics
  sample_size integer NOT NULL,
  win_rate numeric NOT NULL,
  avg_profit_factor numeric NOT NULL,
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- Application Rules
  recommended_action text NOT NULL,
  apply_when_conditions jsonb NOT NULL,
  avoid_when_conditions jsonb NOT NULL,

  -- Metadata
  importance_weight numeric DEFAULT 1.0,
  times_applied integer DEFAULT 0,
  success_rate_when_applied numeric DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 2: AI TRADE ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_trade_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Trade Reference
  backtest_trade_id uuid REFERENCES backtest_trades(id) ON DELETE CASCADE,
  synthetic_trade_id uuid REFERENCES synthetic_backtest_trades(id) ON DELETE CASCADE,
  live_trade_id uuid REFERENCES trade_history(id) ON DELETE CASCADE,

  -- Trade Basics
  symbol text NOT NULL,
  direction text NOT NULL,
  outcome text NOT NULL,
  pnl numeric NOT NULL,

  -- Entry Analysis
  entry_time timestamptz NOT NULL,
  entry_confidence integer NOT NULL,
  entry_market_conditions jsonb NOT NULL,
  entry_indicators_alignment jsonb NOT NULL,
  entry_quality_score integer CHECK (entry_quality_score >= 0 AND entry_quality_score <= 100),

  -- Why Trade Was Taken
  decision_reasoning text NOT NULL,
  matching_historical_patterns text[],
  ai_conviction_level integer NOT NULL,
  risk_reward_at_entry numeric NOT NULL,

  -- Exit Analysis
  exit_time timestamptz NOT NULL,
  exit_reason text NOT NULL,
  exit_market_conditions jsonb NOT NULL,
  was_exit_optimal boolean NOT NULL,
  better_exit_price_available numeric,

  -- What We Learned
  key_learnings text[] NOT NULL,
  mistakes_identified text[],
  what_worked text[],
  what_failed text[],

  -- Similar Trade Comparison
  similar_trades_count integer DEFAULT 0,
  similar_trades_win_rate numeric DEFAULT 0,
  is_pattern_repeating boolean DEFAULT false,

  -- Performance Impact
  contributed_to_learning boolean DEFAULT true,
  influenced_future_decisions integer DEFAULT 0,

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 3: AI PERFORMANCE EVOLUTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_performance_evolution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Measurement Period
  measurement_date date NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),

  -- Symbol & Strategy
  symbol text NOT NULL,
  strategy_name text NOT NULL,

  -- Core Metrics Evolution
  total_trades integer NOT NULL,
  win_rate numeric NOT NULL,
  profit_factor numeric NOT NULL,
  avg_rr numeric NOT NULL,
  sharpe_ratio numeric,

  -- Confidence Threshold History
  confidence_threshold_used integer NOT NULL,
  threshold_was_optimal boolean NOT NULL,
  optimal_threshold_calculated integer,

  -- Learning Impact
  insights_applied integer DEFAULT 0,
  insights_success_rate numeric DEFAULT 0,
  ai_decisions_made integer DEFAULT 0,
  ai_decision_accuracy numeric DEFAULT 0,

  -- Improvement Tracking
  win_rate_change_from_previous numeric,
  profit_factor_change_from_previous numeric,
  is_improving boolean NOT NULL,
  improvement_velocity numeric,

  -- Market Condition Performance
  trending_market_win_rate numeric,
  ranging_market_win_rate numeric,
  high_volatility_win_rate numeric,
  low_volatility_win_rate numeric,

  -- Best Performers
  best_time_of_day text,
  best_setup_type text,
  best_entry_pattern text,

  -- Notes
  learning_summary text,
  adjustments_made text[],
  next_optimization_targets text[],

  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, symbol, strategy_name, measurement_date, period_type)
);

-- ============================================================================
-- TABLE 4: AI DECISION FEEDBACK
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_decision_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Decision Context
  decision_time timestamptz NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('take_trade', 'skip_trade', 'close_early', 'hold_longer')),

  -- Trade Information
  symbol text NOT NULL,
  direction text,
  signal_strength integer NOT NULL,

  -- AI Reasoning
  ai_confidence integer NOT NULL,
  ai_reasoning text NOT NULL,
  key_factors jsonb NOT NULL,
  similar_scenarios_count integer DEFAULT 0,
  historical_success_rate numeric,

  -- Decision Made
  decision_made boolean NOT NULL,
  decision_rationale text NOT NULL,

  -- Outcome (filled after trade completes)
  actual_outcome text,
  was_decision_correct boolean,
  pnl_if_taken numeric,
  pnl_if_skipped numeric,
  optimal_action text,

  -- Learning Feedback
  decision_quality_score integer CHECK (decision_quality_score >= 0 AND decision_quality_score <= 100),
  should_repeat_in_future boolean,
  confidence_adjustment_needed integer,

  -- Pattern Recognition
  matched_patterns text[],
  new_pattern_discovered boolean DEFAULT false,

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 5: AI MARKET SCENARIO PERFORMANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_market_scenario_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Scenario Definition
  scenario_name text NOT NULL,
  market_type text NOT NULL CHECK (market_type IN ('trending_up', 'trending_down', 'ranging', 'high_volatility', 'low_volatility', 'breakout', 'reversal')),
  symbol text NOT NULL,
  timeframe text NOT NULL,

  -- Performance in This Scenario
  total_occurrences integer DEFAULT 0,
  trades_taken integer DEFAULT 0,
  trades_won integer DEFAULT 0,
  trades_lost integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_profit_per_trade numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,

  -- Optimal Strategy
  best_strategy text,
  best_entry_pattern text,
  optimal_confidence_threshold integer,
  recommended_risk_reward numeric,

  -- Scenario Indicators
  indicator_settings jsonb,
  key_signals_to_watch text[],
  warning_signs text[],

  -- Success Factors
  what_works_best text[],
  what_to_avoid text[],
  optimal_holding_duration_minutes integer,

  -- Confidence Scoring
  scenario_reliability_score integer CHECK (scenario_reliability_score >= 0 AND scenario_reliability_score <= 100),
  sample_size_sufficient boolean DEFAULT false,

  -- Last Analysis
  last_updated timestamptz DEFAULT now(),
  last_trade_in_scenario timestamptz,

  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, symbol, timeframe, scenario_name)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- AI Learning Insights
CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_user_symbol ON ai_learning_insights(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_type ON ai_learning_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_confidence ON ai_learning_insights(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_success_rate ON ai_learning_insights(success_rate_when_applied DESC);

-- AI Trade Analysis
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_user_symbol ON ai_trade_analysis(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_outcome ON ai_trade_analysis(outcome);
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_entry_time ON ai_trade_analysis(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_pattern_repeating ON ai_trade_analysis(is_pattern_repeating) WHERE is_pattern_repeating = true;

-- AI Performance Evolution
CREATE INDEX IF NOT EXISTS idx_ai_performance_evolution_user_symbol ON ai_performance_evolution(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_performance_evolution_date ON ai_performance_evolution(measurement_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_performance_evolution_improving ON ai_performance_evolution(is_improving);

-- AI Decision Feedback
CREATE INDEX IF NOT EXISTS idx_ai_decision_feedback_user_symbol ON ai_decision_feedback(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_decision_feedback_time ON ai_decision_feedback(decision_time DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decision_feedback_quality ON ai_decision_feedback(decision_quality_score DESC);

-- AI Market Scenario Performance
CREATE INDEX IF NOT EXISTS idx_ai_market_scenario_user_symbol ON ai_market_scenario_performance(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_ai_market_scenario_type ON ai_market_scenario_performance(market_type);
CREATE INDEX IF NOT EXISTS idx_ai_market_scenario_win_rate ON ai_market_scenario_performance(win_rate DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE ai_learning_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_trade_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_performance_evolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decision_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_market_scenario_performance ENABLE ROW LEVEL SECURITY;

-- AI Learning Insights Policies
CREATE POLICY "Users can view own learning insights"
  ON ai_learning_insights FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own learning insights"
  ON ai_learning_insights FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own learning insights"
  ON ai_learning_insights FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- AI Trade Analysis Policies
CREATE POLICY "Users can view own trade analysis"
  ON ai_trade_analysis FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trade analysis"
  ON ai_trade_analysis FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- AI Performance Evolution Policies
CREATE POLICY "Users can view own performance evolution"
  ON ai_performance_evolution FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own performance evolution"
  ON ai_performance_evolution FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own performance evolution"
  ON ai_performance_evolution FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- AI Decision Feedback Policies
CREATE POLICY "Users can view own decision feedback"
  ON ai_decision_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own decision feedback"
  ON ai_decision_feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own decision feedback"
  ON ai_decision_feedback FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- AI Market Scenario Performance Policies
CREATE POLICY "Users can view own scenario performance"
  ON ai_market_scenario_performance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own scenario performance"
  ON ai_market_scenario_performance FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scenario performance"
  ON ai_market_scenario_performance FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to calculate decision quality score
CREATE OR REPLACE FUNCTION calculate_decision_quality_score(
  p_was_decision_correct boolean,
  p_confidence integer,
  p_historical_success_rate numeric
)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_was_decision_correct THEN
    -- Good decision: High score if confidence matched success rate
    RETURN LEAST(100, p_confidence + ROUND((p_historical_success_rate - 50) * 0.5));
  ELSE
    -- Bad decision: Low score, worse if confidence was high
    RETURN GREATEST(0, 50 - p_confidence / 2);
  END IF;
END;
$$;

-- Function to update insight success rate
CREATE OR REPLACE FUNCTION update_insight_success_rate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ai_learning_insights
  SET
    times_applied = times_applied + 1,
    success_rate_when_applied = (
      SELECT AVG(CASE WHEN was_decision_correct THEN 100.0 ELSE 0.0 END)
      FROM ai_decision_feedback
      WHERE matched_patterns @> ARRAY[NEW.insight_title]
    ),
    updated_at = now()
  WHERE insight_title = ANY(NEW.matched_patterns);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_insight_success_rate ON ai_decision_feedback;
CREATE TRIGGER trigger_update_insight_success_rate
  AFTER UPDATE OF was_decision_correct ON ai_decision_feedback
  FOR EACH ROW
  WHEN (NEW.was_decision_correct IS NOT NULL)
  EXECUTE FUNCTION update_insight_success_rate();

-- ============================================================================
-- UTILITY VIEWS
-- ============================================================================

-- View: AI Learning Summary
CREATE OR REPLACE VIEW ai_learning_summary AS
SELECT
  user_id,
  symbol,
  COUNT(*) as total_insights,
  AVG(confidence_score) as avg_confidence,
  AVG(success_rate_when_applied) as avg_success_rate,
  SUM(times_applied) as total_applications,
  COUNT(*) FILTER (WHERE insight_type = 'winning_pattern') as winning_patterns,
  COUNT(*) FILTER (WHERE insight_type = 'losing_pattern') as losing_patterns
FROM ai_learning_insights
GROUP BY user_id, symbol;

-- View: Recent Performance Trends
CREATE OR REPLACE VIEW ai_recent_performance_trends AS
SELECT
  user_id,
  symbol,
  strategy_name,
  measurement_date,
  win_rate,
  profit_factor,
  is_improving,
  win_rate - LAG(win_rate) OVER (PARTITION BY user_id, symbol ORDER BY measurement_date) as win_rate_delta
FROM ai_performance_evolution
WHERE measurement_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY measurement_date DESC;
