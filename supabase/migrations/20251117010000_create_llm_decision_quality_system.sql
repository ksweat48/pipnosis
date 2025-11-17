/*
  # LLM Decision Quality Tracking System

  ## Overview
  Replaces the old AI capability scoring system with LLM-specific decision quality tracking
  for the new GPT-4-based Pipnosis system.

  ## New Tables

  ### 1. `llm_decision_quality_scores` - Replaces ai_capability_scores
  ### 2. `llm_recommendation_logs` - Replaces missed_opportunities
  ### 3. `llm_prompt_templates` - Stores versioned system prompts
  ### 4. `llm_backtest_configs` - LLM-specific backtest configurations
  ### 5. `llm_cost_tracking` - API usage and cost analytics

  ## Security
  - Admin-only access via RLS policies
  - All tables check user_profiles.is_admin = true
*/

-- ============================================================================
-- TABLE 1: LLM DECISION QUALITY SCORES
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_decision_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES backtest_sessions(id) ON DELETE CASCADE,

  -- Score Identity
  measurement_period text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,

  -- Overall LLM Decision Quality (Target: 75%+)
  overall_decision_quality_percent numeric NOT NULL,
  quality_grade text NOT NULL CHECK (quality_grade IN ('excellent', 'good', 'fair', 'poor')),

  -- Core LLM Metrics
  llm_decision_accuracy numeric NOT NULL, -- % of LLM recommendations that were profitable
  prompt_effectiveness_score numeric NOT NULL, -- Quality of prompt template used
  confidence_calibration_score numeric NOT NULL, -- How well LLM confidence matches reality
  reasoning_quality_score numeric NOT NULL, -- Quality of LLM explanations
  cost_efficiency_score numeric NOT NULL, -- Profit per API dollar spent

  -- Decision Breakdown
  total_llm_decisions integer NOT NULL,
  llm_profitable_decisions integer NOT NULL,
  llm_unprofitable_decisions integer NOT NULL,
  fallback_decisions_used integer NOT NULL,

  -- Recommendation Quality
  true_positives integer NOT NULL, -- LLM said trade, it won
  false_positives integer NOT NULL, -- LLM said trade, it lost
  true_negatives integer NOT NULL, -- LLM said no trade, would have lost
  false_negatives integer NOT NULL, -- LLM said no trade, would have won

  -- Performance by Market Condition
  trending_market_accuracy numeric,
  ranging_market_accuracy numeric,
  high_volatility_accuracy numeric,
  low_volatility_accuracy numeric,

  -- Performance by Symbol
  eurusd_accuracy numeric,
  xauusd_accuracy numeric,
  gbpusd_accuracy numeric,
  usdjpy_accuracy numeric,
  us30_accuracy numeric,

  -- Cost Analysis
  total_api_calls integer NOT NULL,
  total_api_cost numeric NOT NULL,
  avg_response_time_ms numeric,
  api_failure_rate numeric DEFAULT 0,
  profit_per_api_dollar numeric,

  -- Prompt Analysis
  prompt_template_id uuid REFERENCES llm_prompt_templates(id),
  prompt_temperature numeric,
  prompt_max_tokens integer,

  -- Short-Term Trading Compliance
  avg_trade_duration_minutes numeric,
  trades_within_preferred_duration_percent numeric,
  overnight_hold_violations integer DEFAULT 0,
  pipnosis_rule_compliance_percent numeric DEFAULT 100,

  -- Improvement Tracking
  previous_quality_percent numeric,
  improvement_percent numeric,
  target_quality_percent numeric DEFAULT 75,
  gap_to_target numeric,

  -- Recommendations
  primary_weakness text,
  recommended_prompt_adjustments jsonb,
  recommended_temperature numeric,
  estimated_quality_after_adjustments numeric,

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 2: LLM RECOMMENDATION LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_recommendation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES backtest_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Context
  symbol text NOT NULL,
  recommendation_time timestamptz NOT NULL,
  market_snapshot jsonb NOT NULL,

  -- LLM Decision
  llm_action text NOT NULL CHECK (llm_action IN ('enter_long', 'enter_short', 'no_trade', 'hold', 'close')),
  llm_confidence numeric NOT NULL CHECK (llm_confidence >= 0 AND llm_confidence <= 100),
  llm_reasoning text NOT NULL,
  llm_risk_assessment text,
  llm_setup_type text NOT NULL,
  llm_key_factors text[],

  -- Expected Trade Details (if action was enter_long/short)
  expected_entry_price numeric,
  expected_stop_loss numeric,
  expected_take_profit numeric,
  expected_duration_minutes integer,
  expected_position_size_percent numeric,

  -- Actual Outcome Validation
  was_executed boolean NOT NULL,
  actual_outcome text CHECK (actual_outcome IN ('win', 'loss', 'breakeven', 'not_executed', 'would_have_won', 'would_have_lost')),
  actual_pnl numeric DEFAULT 0,

  -- Quality Assessment
  recommendation_was_correct boolean NOT NULL,
  recommendation_quality_score integer CHECK (recommendation_quality_score >= 0 AND recommendation_quality_score <= 100),

  -- Classification
  recommendation_type text NOT NULL CHECK (recommendation_type IN ('true_positive', 'false_positive', 'true_negative', 'false_negative')),

  -- API Performance
  api_response_time_ms numeric,
  api_call_succeeded boolean DEFAULT true,
  used_fallback boolean DEFAULT false,

  -- Learning Insights
  what_went_right text,
  what_went_wrong text,
  prompt_adjustment_needed text,

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 3: LLM PROMPT TEMPLATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Template Identity
  template_name text NOT NULL,
  template_version integer NOT NULL,
  description text,
  template_type text NOT NULL CHECK (template_type IN ('system', 'user', 'combined')),

  -- Prompt Content
  system_prompt text,
  user_prompt_template text,

  -- Configuration
  recommended_temperature numeric DEFAULT 0.3,
  recommended_max_tokens integer DEFAULT 1000,
  trading_style text DEFAULT 'short_term' CHECK (trading_style IN ('scalping', 'short_term', 'intraday')),

  -- Performance Tracking
  times_used integer DEFAULT 0,
  total_decisions integer DEFAULT 0,
  profitable_decisions integer DEFAULT 0,
  avg_win_rate numeric DEFAULT 0,
  avg_decision_quality numeric DEFAULT 0,

  -- Status
  is_active boolean DEFAULT false,
  is_baseline boolean DEFAULT false,

  -- Testing Results
  best_market_condition text,
  worst_market_condition text,
  best_symbol text,
  worst_symbol text,

  -- Meta
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 4: LLM BACKTEST CONFIGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_backtest_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES backtest_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- LLM Configuration
  llm_provider text NOT NULL DEFAULT 'gpt4',
  llm_model text NOT NULL DEFAULT 'gpt-4o',
  temperature numeric NOT NULL DEFAULT 0.3,
  max_tokens integer NOT NULL DEFAULT 1000,

  -- Prompt Setup
  prompt_template_id uuid REFERENCES llm_prompt_templates(id),
  system_prompt_used text NOT NULL,

  -- Fallback Settings
  fallback_enabled boolean DEFAULT true,
  fallback_triggered_count integer DEFAULT 0,

  -- Cost Estimation
  estimated_cost_per_call numeric DEFAULT 0.01,
  estimated_total_cost numeric,
  actual_total_cost numeric,

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 5: LLM COST TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_cost_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES backtest_sessions(id) ON DELETE CASCADE,

  -- Time Period
  tracking_period text NOT NULL, -- 'daily', 'weekly', 'monthly', 'session'
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,

  -- Usage Statistics
  total_api_calls integer NOT NULL,
  successful_calls integer NOT NULL,
  failed_calls integer NOT NULL,
  fallback_calls integer NOT NULL,

  -- Cost Breakdown
  total_cost numeric NOT NULL,
  cost_per_call numeric NOT NULL,
  cost_per_decision numeric NOT NULL,
  cost_per_trade numeric,

  -- Performance Metrics
  total_trades_executed integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  total_profit numeric DEFAULT 0,

  -- Efficiency Metrics
  profit_per_dollar_spent numeric,
  roi_on_api_costs numeric,
  cost_as_percent_of_profit numeric,

  -- Response Time Analytics
  avg_response_time_ms numeric,
  min_response_time_ms numeric,
  max_response_time_ms numeric,

  -- Provider Info
  llm_provider text NOT NULL,
  llm_model text NOT NULL,

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- LLM Decision Quality Scores
CREATE INDEX IF NOT EXISTS idx_llm_quality_scores_user_id ON llm_decision_quality_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_quality_scores_session_id ON llm_decision_quality_scores(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_quality_scores_period ON llm_decision_quality_scores(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_llm_quality_scores_quality ON llm_decision_quality_scores(overall_decision_quality_percent DESC);

-- LLM Recommendation Logs
CREATE INDEX IF NOT EXISTS idx_llm_recommendations_session_id ON llm_recommendation_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_recommendations_symbol ON llm_recommendation_logs(symbol);
CREATE INDEX IF NOT EXISTS idx_llm_recommendations_time ON llm_recommendation_logs(recommendation_time);
CREATE INDEX IF NOT EXISTS idx_llm_recommendations_type ON llm_recommendation_logs(recommendation_type);
CREATE INDEX IF NOT EXISTS idx_llm_recommendations_correct ON llm_recommendation_logs(recommendation_was_correct);

-- LLM Prompt Templates
CREATE INDEX IF NOT EXISTS idx_llm_prompts_user_id ON llm_prompt_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_prompts_active ON llm_prompt_templates(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_llm_prompts_performance ON llm_prompt_templates(avg_win_rate DESC);

-- LLM Backtest Configs
CREATE INDEX IF NOT EXISTS idx_llm_configs_session_id ON llm_backtest_configs(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_configs_template_id ON llm_backtest_configs(prompt_template_id);

-- LLM Cost Tracking
CREATE INDEX IF NOT EXISTS idx_llm_cost_user_id ON llm_cost_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_cost_period ON llm_cost_tracking(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_llm_cost_session_id ON llm_cost_tracking(session_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE llm_decision_quality_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_recommendation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_backtest_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_cost_tracking ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for llm_decision_quality_scores
CREATE POLICY "Admins can view LLM quality scores"
  ON llm_decision_quality_scores FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can manage LLM quality scores"
  ON llm_decision_quality_scores FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for llm_recommendation_logs
CREATE POLICY "Admins can view LLM recommendation logs"
  ON llm_recommendation_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create LLM recommendation logs"
  ON llm_recommendation_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for llm_prompt_templates
CREATE POLICY "Admins can view LLM prompt templates"
  ON llm_prompt_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can manage LLM prompt templates"
  ON llm_prompt_templates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for llm_backtest_configs
CREATE POLICY "Admins can view LLM backtest configs"
  ON llm_backtest_configs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create LLM backtest configs"
  ON llm_backtest_configs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for llm_cost_tracking
CREATE POLICY "Admins can view LLM cost tracking"
  ON llm_cost_tracking FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can manage LLM cost tracking"
  ON llm_cost_tracking FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Calculate LLM decision accuracy
CREATE OR REPLACE FUNCTION calculate_llm_decision_accuracy(
  p_profitable_decisions integer,
  p_total_decisions integer
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_total_decisions = 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND((p_profitable_decisions::numeric / p_total_decisions::numeric) * 100, 2);
END;
$$;

-- Calculate cost efficiency score
CREATE OR REPLACE FUNCTION calculate_cost_efficiency(
  p_total_profit numeric,
  p_total_api_cost numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_total_api_cost = 0 THEN
    RETURN 999.99;
  END IF;
  IF p_total_profit <= 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND(p_total_profit / p_total_api_cost, 2);
END;
$$;

-- Calculate confidence calibration score
CREATE OR REPLACE FUNCTION calculate_confidence_calibration(
  p_avg_confidence numeric,
  p_actual_win_rate numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_calibration_error numeric;
  v_score numeric;
BEGIN
  -- Calculate how far off the confidence was from reality
  v_calibration_error := ABS(p_avg_confidence - p_actual_win_rate);

  -- Perfect calibration = 100, errors reduce score
  v_score := GREATEST(0, 100 - (v_calibration_error * 2));

  RETURN ROUND(v_score, 2);
END;
$$;
