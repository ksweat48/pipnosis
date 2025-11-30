/*
  # Create Counterfactual Learning System

  ## Overview
  This migration creates the infrastructure for counterfactual trade analysis - simulating "what if" scenarios
  for every closed trade to discover optimal SL/TP/Risk parameters without LLM cost.

  ## New Tables

  ### `ai_counterfactuals`
  Stores alternate timeline simulations for each trade:
  - Links to actual trade via `trade_id`
  - Tracks variant type (SL/TP/Risk/EarlyExit/HoldLonger)
  - Compares counterfactual outcome vs actual outcome
  - Records what would have happened in alternate universe
  - Captures time-to-resolution data
  - Stores market regime context for pattern mining

  ## Use Cases
  1. **SL Optimization**: Did tighter or wider stops perform better?
  2. **TP Extension**: Would holding longer have captured more profit?
  3. **Risk Sizing**: What position size would have been optimal?
  4. **Early Exit**: Should we have exited on pullback?
  5. **Pattern Mining**: Cluster winning parameters by regime

  ## Security
  - RLS enabled for user privacy
  - Users can only access their own counterfactuals
  - Service role can write for automated analysis

  ## Performance
  - Indexed on trade_id for fast lookups
  - Indexed on variant_type for pattern analysis
  - Indexed on symbol + market_regime for regime-specific queries

  ## Data Safety
  - No destructive operations
  - Read-only simulation data
  - Builds training dataset for future intelligence
*/

-- Create ai_counterfactuals table
CREATE TABLE IF NOT EXISTS ai_counterfactuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '15m',

  -- Variant details
  variant_type TEXT NOT NULL CHECK (variant_type IN ('sl_variant', 'tp_variant', 'risk_variant', 'early_exit', 'hold_longer')),
  variant_setting NUMERIC NOT NULL,
  variant_description TEXT,

  -- Simulation results
  counterfactual_pnl NUMERIC NOT NULL,
  actual_pnl NUMERIC NOT NULL,
  rr_difference NUMERIC GENERATED ALWAYS AS (counterfactual_pnl - actual_pnl) STORED,

  -- Outcome flags
  would_hit_tp BOOLEAN NOT NULL DEFAULT false,
  would_hit_sl BOOLEAN NOT NULL DEFAULT false,
  would_reverse_later BOOLEAN NOT NULL DEFAULT false,

  -- Timing
  time_to_resolution_minutes INTEGER,
  candles_held INTEGER,

  -- Market context (for pattern mining)
  market_regime TEXT CHECK (market_regime IN ('bull', 'bear', 'sideways', 'volatile')),
  volatility_regime TEXT CHECK (volatility_regime IN ('low', 'medium', 'high')),

  -- Metadata
  simulation_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_counterfactuals_trade_id ON ai_counterfactuals(trade_id);
CREATE INDEX IF NOT EXISTS idx_counterfactuals_user_id ON ai_counterfactuals(user_id);
CREATE INDEX IF NOT EXISTS idx_counterfactuals_variant_type ON ai_counterfactuals(variant_type);
CREATE INDEX IF NOT EXISTS idx_counterfactuals_symbol_regime ON ai_counterfactuals(symbol, market_regime);
CREATE INDEX IF NOT EXISTS idx_counterfactuals_created_at ON ai_counterfactuals(created_at DESC);

-- Create composite index for pattern mining queries
CREATE INDEX IF NOT EXISTS idx_counterfactuals_mining
ON ai_counterfactuals(user_id, variant_type, symbol, market_regime, volatility_regime)
WHERE rr_difference > 0;

-- Enable RLS
ALTER TABLE ai_counterfactuals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own counterfactuals"
  ON ai_counterfactuals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own counterfactuals"
  ON ai_counterfactuals
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role has full access to counterfactuals"
  ON ai_counterfactuals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create view for best alternate outcomes per trade
CREATE OR REPLACE VIEW v_best_counterfactuals AS
SELECT DISTINCT ON (trade_id, variant_type)
  trade_id,
  variant_type,
  variant_setting,
  counterfactual_pnl,
  actual_pnl,
  rr_difference,
  would_hit_tp,
  would_hit_sl,
  time_to_resolution_minutes,
  market_regime,
  volatility_regime
FROM ai_counterfactuals
WHERE rr_difference > 0
ORDER BY trade_id, variant_type, rr_difference DESC;

-- Create aggregation view for pattern mining
CREATE OR REPLACE VIEW v_counterfactual_patterns AS
SELECT
  user_id,
  symbol,
  variant_type,
  market_regime,
  volatility_regime,
  COUNT(*) as sample_count,
  AVG(variant_setting) as optimal_setting,
  AVG(rr_difference) as avg_improvement,
  SUM(CASE WHEN rr_difference > 0 THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as success_rate,
  AVG(time_to_resolution_minutes) as avg_hold_time
FROM ai_counterfactuals
WHERE variant_type IN ('sl_variant', 'tp_variant', 'risk_variant')
GROUP BY user_id, symbol, variant_type, market_regime, volatility_regime
HAVING COUNT(*) >= 5;

-- Create helper function to get optimal parameters
CREATE OR REPLACE FUNCTION get_optimal_parameters(
  p_user_id UUID,
  p_symbol TEXT,
  p_market_regime TEXT DEFAULT NULL,
  p_volatility_regime TEXT DEFAULT NULL
)
RETURNS TABLE (
  variant_type TEXT,
  optimal_setting NUMERIC,
  avg_improvement NUMERIC,
  success_rate NUMERIC,
  sample_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cp.variant_type,
    cp.optimal_setting,
    cp.avg_improvement,
    cp.success_rate,
    cp.sample_count
  FROM v_counterfactual_patterns cp
  WHERE cp.user_id = p_user_id
    AND cp.symbol = p_symbol
    AND (p_market_regime IS NULL OR cp.market_regime = p_market_regime)
    AND (p_volatility_regime IS NULL OR cp.volatility_regime = p_volatility_regime)
  ORDER BY cp.avg_improvement DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_optimal_parameters TO authenticated;
GRANT EXECUTE ON FUNCTION get_optimal_parameters TO service_role;

-- Create table for counterfactual insights (optional LLM summaries)
CREATE TABLE IF NOT EXISTS ai_counterfactual_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Insight summary
  insight_summary TEXT NOT NULL,
  best_sl_multiplier NUMERIC,
  best_tp_multiplier NUMERIC,
  best_risk_pct NUMERIC,
  early_exit_recommended BOOLEAN DEFAULT false,
  hold_longer_recommended BOOLEAN DEFAULT false,

  -- Recommendations
  actionable_recommendation TEXT,
  estimated_improvement_dollars NUMERIC,
  estimated_improvement_pct NUMERIC,

  -- Metadata
  llm_tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_counterfactual_insights_trade ON ai_counterfactual_insights(trade_id);
CREATE INDEX IF NOT EXISTS idx_counterfactual_insights_user ON ai_counterfactual_insights(user_id);

-- Enable RLS
ALTER TABLE ai_counterfactual_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own insights"
  ON ai_counterfactual_insights
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insights"
  ON ai_counterfactual_insights
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role has full access to insights"
  ON ai_counterfactual_insights
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE ai_counterfactuals IS 'Stores alternate timeline simulations for closed trades - what would have happened with different SL/TP/Risk settings';
COMMENT ON TABLE ai_counterfactual_insights IS 'LLM-generated summaries of counterfactual analysis with actionable recommendations';
