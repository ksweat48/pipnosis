/*
  # Fix Mastery Curve Missing Tables
  
  ## Summary
  Creates two missing tables required by the Mastery Curve feature:
  - ai_learning_insights
  - llm_layer_kpis
  
  ## Tables Created
  
  ### 1. ai_learning_insights
  Stores extracted patterns and lessons learned from trading analysis.
  - Pattern identification and classification
  - Market context and conditions
  - Performance metrics and confidence scores
  - Application rules and success tracking
  
  ### 2. llm_layer_kpis  
  Tracks performance metrics for the 5-layer LLM safety pipeline.
  - Daily KPIs per layer (0-5)
  - Pass/reject rates and confidence levels
  - Token usage and processing times
  - Rejection reasons for analysis
  
  ## Security
  - RLS enabled on both tables
  - Users can only access their own data
  - Policies for SELECT, INSERT, UPDATE operations
*/

-- ============================================================================
-- TABLE 1: AI LEARNING INSIGHTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source Information
  backtest_session_id uuid,
  synthetic_session_id uuid,
  is_from_live_trading boolean DEFAULT false,

  -- Pattern Identification
  insight_type text NOT NULL CHECK (insight_type IN ('positive', 'negative', 'winning_pattern', 'losing_pattern', 'optimal_timing', 'risk_management', 'market_condition', 'strategy_preference')),
  symbol text NOT NULL,
  timeframe text NOT NULL,

  -- Market Context
  market_scenario text NOT NULL,
  volatility_level text NOT NULL,
  trend_direction text NOT NULL,

  -- The Insight
  insight_title text NOT NULL,
  insight_description text NOT NULL,
  pattern_features jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Performance Metrics
  sample_size integer NOT NULL DEFAULT 1,
  win_rate numeric NOT NULL DEFAULT 50,
  avg_profit_factor numeric NOT NULL DEFAULT 1.0,
  confidence_score numeric NOT NULL DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- Application Rules
  recommended_action text NOT NULL,
  apply_when_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  avoid_when_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Metadata
  importance_weight numeric DEFAULT 1.0,
  times_applied integer DEFAULT 0,
  success_rate_when_applied numeric DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_user_id ON ai_learning_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_created_at ON ai_learning_insights(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_learning_insights_symbol ON ai_learning_insights(symbol);

ALTER TABLE ai_learning_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learning insights"
  ON ai_learning_insights FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learning insights"
  ON ai_learning_insights FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own learning insights"
  ON ai_learning_insights FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- TABLE 2: LLM LAYER KPIs
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

CREATE INDEX IF NOT EXISTS idx_llm_layer_kpis_user_date ON llm_layer_kpis(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_llm_layer_kpis_layer ON llm_layer_kpis(layer_number);

ALTER TABLE llm_layer_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own LLM layer KPIs"
  ON llm_layer_kpis FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own LLM layer KPIs"
  ON llm_layer_kpis FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own LLM layer KPIs"
  ON llm_layer_kpis FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
