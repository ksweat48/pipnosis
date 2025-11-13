/*
  # GPT-4o Meta-Learning Intelligence System

  ## Overview
  This migration creates tables for the GPT-4o-powered Meta-Learning Strategist and Pattern Interpreter.
  These systems analyze backtest results and AI learning data to provide strategic insights and human-readable explanations.

  ## New Tables

  ### 1. ai_meta_learning_insights
  Stores strategic recommendations from GPT-4o after analyzing backtest results
  - High-level interpretation of AI performance
  - Strategic recommendations for improvement
  - Pattern emphasis/de-weighting suggestions
  - New rule ideas to test
  - Risk management adjustments
  - Regime change detection

  ### 2. ai_pattern_interpretations
  Stores human-readable explanations of discovered patterns from GPT-4o
  - Why patterns work (market psychology)
  - When to use patterns (optimal conditions)
  - What to avoid (danger signals)
  - Pattern synergies and combinations
  - Risk notes and warnings

  ### 3. gpt4o_usage_tracking
  Tracks API usage, costs, and performance of GPT-4o calls
  - Token consumption monitoring
  - Cost tracking and budgeting
  - Response quality metrics
  - Error rate monitoring

  ## Important Design Principles
  - GPT-4o never accesses raw candle data
  - GPT-4o operates only on summarized statistics
  - Rule-based learning remains primary; GPT-4o adds intelligence
  - System continues working if GPT-4o is disabled
*/

-- ============================================================================
-- 1. AI Meta-Learning Insights Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_meta_learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Link to source data
  backtest_session_id uuid,
  synthetic_session_id uuid,
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  analysis_type text NOT NULL CHECK (analysis_type IN ('post_backtest', 'daily_review', 'weekly_review', 'pattern_analysis')),

  -- Input summary data (what GPT-4o analyzed)
  input_summary jsonb NOT NULL,

  -- GPT-4o Strategic Analysis Output
  high_level_interpretation text NOT NULL,
  strategic_recommendations jsonb NOT NULL,
  patterns_to_emphasize text[],
  patterns_to_deweight text[],
  patterns_to_ignore text[],
  new_rule_ideas jsonb,
  risk_management_adjustments jsonb,
  regime_changes_detected jsonb,
  tomorrow_priorities text[],

  -- Metadata
  gpt4o_model text DEFAULT 'gpt-4o',
  tokens_used integer,
  processing_time_ms integer,
  confidence_score decimal(5,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for ai_meta_learning_insights
CREATE INDEX IF NOT EXISTS idx_meta_insights_user_id ON ai_meta_learning_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_meta_insights_date ON ai_meta_learning_insights(analysis_date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_insights_type ON ai_meta_learning_insights(analysis_type);
CREATE INDEX IF NOT EXISTS idx_meta_insights_backtest ON ai_meta_learning_insights(backtest_session_id);
CREATE INDEX IF NOT EXISTS idx_meta_insights_created ON ai_meta_learning_insights(created_at DESC);

-- Enable RLS
ALTER TABLE ai_meta_learning_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own meta-learning insights"
  ON ai_meta_learning_insights
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert meta-learning insights"
  ON ai_meta_learning_insights
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 2. AI Pattern Interpretations Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_pattern_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Link to pattern
  pattern_id uuid,
  pattern_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text,

  -- Pattern statistics (what GPT-4o interpreted)
  pattern_summary jsonb NOT NULL,

  -- GPT-4o Interpretation Output
  plain_english_explanation text NOT NULL,
  why_it_works text NOT NULL,
  market_psychology_notes text,
  optimal_conditions text NOT NULL,
  conditions_to_avoid text NOT NULL,
  risk_warnings text[],
  confidence_level text CHECK (confidence_level IN ('high', 'medium', 'low')),

  -- Trading guidance
  how_to_use_in_trading text NOT NULL,
  position_sizing_guidance text,
  entry_timing_guidance text,
  exit_timing_guidance text,

  -- Pattern relationships
  synergies_with_patterns text[],
  conflicts_with_patterns text[],

  -- Pattern health
  degradation_signs text[],
  pattern_strength_assessment text,

  -- Metadata
  gpt4o_model text DEFAULT 'gpt-4o',
  tokens_used integer,
  interpretation_quality_score decimal(5,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for ai_pattern_interpretations
CREATE INDEX IF NOT EXISTS idx_pattern_interp_user_id ON ai_pattern_interpretations(user_id);
CREATE INDEX IF NOT EXISTS idx_pattern_interp_pattern_id ON ai_pattern_interpretations(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_interp_symbol ON ai_pattern_interpretations(symbol);
CREATE INDEX IF NOT EXISTS idx_pattern_interp_name ON ai_pattern_interpretations(pattern_name);
CREATE INDEX IF NOT EXISTS idx_pattern_interp_created ON ai_pattern_interpretations(created_at DESC);

-- Enable RLS
ALTER TABLE ai_pattern_interpretations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own pattern interpretations"
  ON ai_pattern_interpretations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert pattern interpretations"
  ON ai_pattern_interpretations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can update pattern interpretations"
  ON ai_pattern_interpretations
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 3. GPT-4o Usage Tracking Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS gpt4o_usage_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Call details
  service_type text NOT NULL CHECK (service_type IN ('meta_learning_strategist', 'pattern_interpreter')),
  function_called text NOT NULL,
  model_used text DEFAULT 'gpt-4o',

  -- Token usage
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  total_tokens integer NOT NULL,

  -- Cost tracking (approximate)
  estimated_cost_usd decimal(10,6),

  -- Performance
  response_time_ms integer,
  success boolean DEFAULT true,
  error_message text,

  -- Context
  related_session_id uuid,
  related_pattern_id uuid,

  -- Timestamps
  called_at timestamptz DEFAULT now()
);

-- Indexes for gpt4o_usage_tracking
CREATE INDEX IF NOT EXISTS idx_gpt4o_usage_user_id ON gpt4o_usage_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_gpt4o_usage_service ON gpt4o_usage_tracking(service_type);
CREATE INDEX IF NOT EXISTS idx_gpt4o_usage_date ON gpt4o_usage_tracking(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpt4o_usage_success ON gpt4o_usage_tracking(success);

-- Enable RLS
ALTER TABLE gpt4o_usage_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own GPT-4o usage"
  ON gpt4o_usage_tracking
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can track GPT-4o usage"
  ON gpt4o_usage_tracking
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 4. Helper Functions
-- ============================================================================

-- Function to get recent meta-learning insights for a user
CREATE OR REPLACE FUNCTION get_recent_meta_insights(
  p_user_id uuid,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  insight_id uuid,
  analysis_date date,
  analysis_type text,
  interpretation text,
  recommendations jsonb,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    id,
    analysis_date,
    analysis_type,
    high_level_interpretation,
    strategic_recommendations,
    created_at
  FROM ai_meta_learning_insights
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get pattern interpretations for a symbol
CREATE OR REPLACE FUNCTION get_pattern_interpretations_for_symbol(
  p_user_id uuid,
  p_symbol text
)
RETURNS TABLE (
  interpretation_id uuid,
  pattern_name text,
  explanation text,
  how_to_use text,
  risk_warnings text[],
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    id,
    pattern_name,
    plain_english_explanation,
    how_to_use_in_trading,
    risk_warnings,
    created_at
  FROM ai_pattern_interpretations
  WHERE user_id = p_user_id AND symbol = p_symbol
  ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate GPT-4o usage costs for a user
CREATE OR REPLACE FUNCTION calculate_gpt4o_costs(
  p_user_id uuid,
  p_start_date date DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  service_type text,
  total_calls bigint,
  total_tokens bigint,
  total_cost_usd decimal
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    service_type,
    COUNT(*)::bigint as total_calls,
    SUM(total_tokens)::bigint as total_tokens,
    SUM(estimated_cost_usd)::decimal as total_cost_usd
  FROM gpt4o_usage_tracking
  WHERE user_id = p_user_id
    AND called_at >= p_start_date
    AND called_at <= p_end_date
    AND success = true
  GROUP BY service_type
  ORDER BY total_cost_usd DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. Triggers for Updated Timestamps
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_meta_insights_updated_at
  BEFORE UPDATE ON ai_meta_learning_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pattern_interp_updated_at
  BEFORE UPDATE ON ai_pattern_interpretations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
