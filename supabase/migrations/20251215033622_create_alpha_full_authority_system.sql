/*
  # Alpha Full Authority Enhancement System

  1. New Tables
    - `alpha_authority_overrides` - Track Alpha's override decisions and outcomes
    - `alpha_confidence_calibration` - Track confidence vs actual win rate
    - `alpha_reasoning_patterns` - Track which reasoning patterns work best
    - `alpha_meta_insights` - Self-awareness and learning insights
    - `alpha_intelligence_cache` - Cache aggregated intelligence for faster decisions
    - `execution_quality_log` - Track execution quality and slippage

  2. Security
    - Enable RLS on all tables
    - Authenticated users can read/write their own data
    - Service role has full access for system operations

  3. Purpose
    - Enable Alpha to override safety rules with statistical justification
    - Track learning and performance calibration
    - Build meta-learning capabilities
*/

-- Alpha authority overrides table
CREATE TABLE IF NOT EXISTS alpha_authority_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid,
  decision_id uuid NOT NULL,
  override_type text NOT NULL CHECK (override_type IN ('adversarial_block', 'regime_avoid', 'risk_limit', 'drawdown_stop', 'correlation_limit', 'manipulation_block')),
  original_recommendation text NOT NULL,
  alpha_override_decision text NOT NULL,
  statistical_justification jsonb NOT NULL,
  expected_edge numeric NOT NULL,
  confidence_level integer NOT NULL CHECK (confidence_level >= 0 AND confidence_level <= 100),
  omega_votes jsonb,
  market_context jsonb,
  actual_outcome text CHECK (actual_outcome IN ('correct', 'incorrect', 'pending', 'partial')),
  outcome_pnl numeric,
  outcome_details jsonb,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_alpha_overrides_user_id ON alpha_authority_overrides(user_id);
CREATE INDEX idx_alpha_overrides_type ON alpha_authority_overrides(override_type);
CREATE INDEX idx_alpha_overrides_outcome ON alpha_authority_overrides(actual_outcome);
CREATE INDEX idx_alpha_overrides_created_at ON alpha_authority_overrides(created_at DESC);

ALTER TABLE alpha_authority_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alpha overrides"
  ON alpha_authority_overrides FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alpha overrides"
  ON alpha_authority_overrides FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own alpha overrides"
  ON alpha_authority_overrides FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alpha confidence calibration table
CREATE TABLE IF NOT EXISTS alpha_confidence_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confidence_bucket integer NOT NULL CHECK (confidence_bucket >= 0 AND confidence_bucket <= 100),
  market_condition text NOT NULL,
  symbol text,
  timeframe text,
  predicted_win_rate numeric NOT NULL,
  actual_win_rate numeric NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  calibration_error numeric NOT NULL,
  total_trades integer NOT NULL DEFAULT 0,
  winning_trades integer NOT NULL DEFAULT 0,
  losing_trades integer NOT NULL DEFAULT 0,
  avg_pnl_r numeric DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_alpha_calibration_unique ON alpha_confidence_calibration(user_id, confidence_bucket, market_condition, COALESCE(symbol, ''), COALESCE(timeframe, ''));
CREATE INDEX idx_alpha_calibration_user ON alpha_confidence_calibration(user_id);
CREATE INDEX idx_alpha_calibration_bucket ON alpha_confidence_calibration(confidence_bucket);

ALTER TABLE alpha_confidence_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own confidence calibration"
  ON alpha_confidence_calibration FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own confidence calibration"
  ON alpha_confidence_calibration FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alpha reasoning patterns table
CREATE TABLE IF NOT EXISTS alpha_reasoning_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_id text NOT NULL,
  reasoning_type text NOT NULL,
  pattern_description text NOT NULL,
  conditions_when_used jsonb NOT NULL,
  market_conditions text[],
  symbols text[],
  usage_count integer DEFAULT 0,
  win_count integer DEFAULT 0,
  loss_count integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_pnl_r numeric DEFAULT 0,
  avg_confidence numeric DEFAULT 0,
  effectiveness_score numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  last_used timestamptz,
  last_updated timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_alpha_patterns_unique ON alpha_reasoning_patterns(user_id, pattern_id);
CREATE INDEX idx_alpha_patterns_user ON alpha_reasoning_patterns(user_id);
CREATE INDEX idx_alpha_patterns_effectiveness ON alpha_reasoning_patterns(effectiveness_score DESC);
CREATE INDEX idx_alpha_patterns_type ON alpha_reasoning_patterns(reasoning_type);

ALTER TABLE alpha_reasoning_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reasoning patterns"
  ON alpha_reasoning_patterns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own reasoning patterns"
  ON alpha_reasoning_patterns FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alpha meta insights table
CREATE TABLE IF NOT EXISTS alpha_meta_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_type text NOT NULL CHECK (insight_type IN ('strength', 'weakness', 'pattern', 'adaptation', 'discovery')),
  market_condition text NOT NULL,
  symbols text[],
  timeframes text[],
  insight_description text NOT NULL,
  supporting_evidence jsonb NOT NULL,
  confidence_in_insight numeric NOT NULL CHECK (confidence_in_insight >= 0 AND confidence_in_insight <= 100),
  actionable_adjustment text NOT NULL,
  times_applied integer DEFAULT 0,
  improvement_seen numeric DEFAULT 0,
  validated boolean DEFAULT false,
  discovered_at timestamptz DEFAULT now(),
  last_validated timestamptz,
  last_applied timestamptz
);

CREATE INDEX idx_alpha_insights_user ON alpha_meta_insights(user_id);
CREATE INDEX idx_alpha_insights_type ON alpha_meta_insights(insight_type);
CREATE INDEX idx_alpha_insights_condition ON alpha_meta_insights(market_condition);
CREATE INDEX idx_alpha_insights_confidence ON alpha_meta_insights(confidence_in_insight DESC);

ALTER TABLE alpha_meta_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meta insights"
  ON alpha_meta_insights FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own meta insights"
  ON alpha_meta_insights FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alpha intelligence cache table (for performance)
CREATE TABLE IF NOT EXISTS alpha_intelligence_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  cache_type text NOT NULL CHECK (cache_type IN ('platform_patterns', 'symbol_intelligence', 'execution_quality', 'calibration_data', 'reasoning_patterns')),
  cached_data jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_alpha_cache_unique ON alpha_intelligence_cache(user_id, cache_key, cache_type);
CREATE INDEX idx_alpha_cache_user ON alpha_intelligence_cache(user_id);
CREATE INDEX idx_alpha_cache_expires ON alpha_intelligence_cache(expires_at);

ALTER TABLE alpha_intelligence_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own intelligence cache"
  ON alpha_intelligence_cache FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own intelligence cache"
  ON alpha_intelligence_cache FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Execution quality tracking table
CREATE TABLE IF NOT EXISTS execution_quality_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  goal_session_id uuid,
  symbol text NOT NULL,
  session text NOT NULL,
  expected_entry numeric NOT NULL,
  actual_entry numeric NOT NULL,
  slippage_pips numeric NOT NULL,
  expected_sl numeric,
  actual_sl_hit numeric,
  sl_hunting_suspected boolean DEFAULT false,
  spread_at_entry numeric,
  spread_at_exit numeric,
  execution_delay_ms integer,
  rejection_occurred boolean DEFAULT false,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_execution_quality_user ON execution_quality_log(user_id);
CREATE INDEX idx_execution_quality_symbol ON execution_quality_log(symbol);
CREATE INDEX idx_execution_quality_session ON execution_quality_log(session);
CREATE INDEX idx_execution_quality_created ON execution_quality_log(created_at DESC);

ALTER TABLE execution_quality_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own execution quality"
  ON execution_quality_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own execution quality"
  ON execution_quality_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Helper function to get Alpha's override success rate
CREATE OR REPLACE FUNCTION get_alpha_override_success_rate(p_user_id uuid, p_override_type text DEFAULT NULL)
RETURNS TABLE (
  override_type text,
  total_overrides bigint,
  correct_overrides bigint,
  incorrect_overrides bigint,
  pending_overrides bigint,
  success_rate numeric,
  avg_edge numeric,
  avg_confidence numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    aao.override_type,
    COUNT(*)::bigint as total_overrides,
    COUNT(*) FILTER (WHERE aao.actual_outcome = 'correct')::bigint as correct_overrides,
    COUNT(*) FILTER (WHERE aao.actual_outcome = 'incorrect')::bigint as incorrect_overrides,
    COUNT(*) FILTER (WHERE aao.actual_outcome = 'pending')::bigint as pending_overrides,
    CASE
      WHEN COUNT(*) FILTER (WHERE aao.actual_outcome IN ('correct', 'incorrect')) > 0
      THEN (COUNT(*) FILTER (WHERE aao.actual_outcome = 'correct')::numeric /
            COUNT(*) FILTER (WHERE aao.actual_outcome IN ('correct', 'incorrect'))::numeric * 100)
      ELSE 0
    END as success_rate,
    AVG(aao.expected_edge) as avg_edge,
    AVG(aao.confidence_level) as avg_confidence
  FROM alpha_authority_overrides aao
  WHERE aao.user_id = p_user_id
    AND (p_override_type IS NULL OR aao.override_type = p_override_type)
  GROUP BY aao.override_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to get calibrated confidence for Alpha
CREATE OR REPLACE FUNCTION get_calibrated_confidence(
  p_user_id uuid,
  p_confidence integer,
  p_market_condition text,
  p_symbol text DEFAULT NULL
) RETURNS numeric AS $$
DECLARE
  v_actual_win_rate numeric;
  v_sample_size integer;
  v_confidence_bucket integer;
BEGIN
  -- Round to nearest 10 for bucketing
  v_confidence_bucket := (p_confidence / 10) * 10;

  -- Get actual win rate for this confidence bucket
  SELECT actual_win_rate, sample_size
  INTO v_actual_win_rate, v_sample_size
  FROM alpha_confidence_calibration
  WHERE user_id = p_user_id
    AND confidence_bucket = v_confidence_bucket
    AND market_condition = p_market_condition
    AND (p_symbol IS NULL OR symbol = p_symbol OR symbol IS NULL)
  ORDER BY sample_size DESC
  LIMIT 1;

  -- If we have enough samples, return calibrated value
  IF v_sample_size >= 10 THEN
    RETURN v_actual_win_rate;
  END IF;

  -- Otherwise return raw confidence
  RETURN p_confidence;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;