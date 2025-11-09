/*
  # Add Advanced Analytics Columns to AI Trade Analysis

  ## Overview
  Adds missing columns to the ai_trade_analysis table that are required for
  advanced trade analytics including Expected Value (EV), trade quality scoring,
  volatility regime tracking, and risk-reward metrics.

  ## Changes

  ### New Columns Added to `ai_trade_analysis`
  1. **realized_rr** (numeric) - Actual risk:reward ratio achieved in the trade
  2. **mae** (numeric) - Maximum Adverse Excursion (worst drawdown during trade)
  3. **mfe** (numeric) - Maximum Favorable Excursion (best profit during trade)
  4. **expected_value** (numeric) - Calculated EV based on pattern history
  5. **trade_quality_score** (integer 0-100) - Overall quality rating of the trade
  6. **volatility_regime** (text) - Market volatility level: low, medium, high

  ## Why These Columns
  - **EV tracking**: Enables pattern-based profitability predictions
  - **Quality scoring**: Measures how well trades align with optimal parameters
  - **Volatility awareness**: Allows strategy adaptation to market conditions
  - **R:R metrics**: Tracks actual vs planned risk:reward performance
  - **MAE/MFE**: Identifies optimal exit timing patterns

  ## Security
  - No RLS changes needed (inherits from existing table policies)
  - All columns are nullable to support legacy data
*/

-- ============================================================================
-- ADD MISSING COLUMNS TO AI_TRADE_ANALYSIS
-- ============================================================================

-- Check if columns exist before adding them
DO $$
BEGIN
  -- Add realized_rr column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis'
    AND column_name = 'realized_rr'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN realized_rr numeric;

    COMMENT ON COLUMN ai_trade_analysis.realized_rr IS
      'Actual risk:reward ratio achieved (exitPrice - entryPrice) / (entryPrice - stopLoss)';
  END IF;

  -- Add mae (Maximum Adverse Excursion)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis'
    AND column_name = 'mae'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN mae numeric;

    COMMENT ON COLUMN ai_trade_analysis.mae IS
      'Maximum Adverse Excursion - worst drawdown during the trade';
  END IF;

  -- Add mfe (Maximum Favorable Excursion)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis'
    AND column_name = 'mfe'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN mfe numeric;

    COMMENT ON COLUMN ai_trade_analysis.mfe IS
      'Maximum Favorable Excursion - best profit achieved during the trade';
  END IF;

  -- Add expected_value
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis'
    AND column_name = 'expected_value'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN expected_value numeric;

    COMMENT ON COLUMN ai_trade_analysis.expected_value IS
      'Expected Value calculated from historical pattern performance';
  END IF;

  -- Add trade_quality_score
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis'
    AND column_name = 'trade_quality_score'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN trade_quality_score integer CHECK (trade_quality_score >= 0 AND trade_quality_score <= 100);

    COMMENT ON COLUMN ai_trade_analysis.trade_quality_score IS
      'Overall quality score 0-100 based on entry timing, R:R, confidence alignment';
  END IF;

  -- Add volatility_regime
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis'
    AND column_name = 'volatility_regime'
  ) THEN
    ALTER TABLE ai_trade_analysis
    ADD COLUMN volatility_regime text CHECK (volatility_regime IN ('low', 'medium', 'high'));

    COMMENT ON COLUMN ai_trade_analysis.volatility_regime IS
      'Market volatility level when trade was taken: low, medium, or high';
  END IF;

END $$;

-- ============================================================================
-- ADD INDEXES FOR QUERY PERFORMANCE
-- ============================================================================

-- Index for EV calculator queries by pattern and volatility
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_pattern_volatility
  ON ai_trade_analysis(user_id, symbol)
  WHERE matching_historical_patterns IS NOT NULL AND volatility_regime IS NOT NULL;

-- Index for quality score analysis
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_quality_score
  ON ai_trade_analysis(trade_quality_score DESC)
  WHERE trade_quality_score IS NOT NULL;

-- Index for volatility regime filtering
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_volatility
  ON ai_trade_analysis(volatility_regime, symbol)
  WHERE volatility_regime IS NOT NULL;

-- Index for EV tracking
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_expected_value
  ON ai_trade_analysis(expected_value DESC)
  WHERE expected_value IS NOT NULL;

-- ============================================================================
-- UTILITY VIEWS
-- ============================================================================

-- View: Trade Quality Distribution
CREATE OR REPLACE VIEW ai_trade_quality_distribution AS
SELECT
  user_id,
  symbol,
  CASE
    WHEN trade_quality_score >= 80 THEN 'Excellent'
    WHEN trade_quality_score >= 60 THEN 'Good'
    WHEN trade_quality_score >= 40 THEN 'Fair'
    ELSE 'Poor'
  END as quality_tier,
  COUNT(*) as trade_count,
  AVG(pnl) as avg_pnl,
  AVG(realized_rr) as avg_realized_rr
FROM ai_trade_analysis
WHERE trade_quality_score IS NOT NULL
GROUP BY user_id, symbol, quality_tier;

-- View: Volatility Performance
CREATE OR REPLACE VIEW ai_volatility_performance AS
SELECT
  user_id,
  symbol,
  volatility_regime,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE outcome = 'win') as wins,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'win') / COUNT(*), 2) as win_rate,
  AVG(pnl) as avg_pnl,
  AVG(expected_value) as avg_ev
FROM ai_trade_analysis
WHERE volatility_regime IS NOT NULL
GROUP BY user_id, symbol, volatility_regime;

-- View: Expected Value Accuracy
CREATE OR REPLACE VIEW ai_ev_accuracy AS
SELECT
  user_id,
  symbol,
  COUNT(*) as total_trades,
  AVG(expected_value) as avg_predicted_ev,
  AVG(pnl) as avg_actual_pnl,
  AVG(pnl) - AVG(expected_value) as ev_prediction_error,
  ROUND(100.0 * (1 - ABS(AVG(pnl) - AVG(expected_value)) / NULLIF(AVG(expected_value), 0)), 2) as ev_accuracy_percent
FROM ai_trade_analysis
WHERE expected_value IS NOT NULL
GROUP BY user_id, symbol
HAVING COUNT(*) >= 10;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to calculate trade quality score (if missing)
CREATE OR REPLACE FUNCTION calculate_trade_quality_score_from_metrics(
  p_outcome text,
  p_realized_rr numeric,
  p_confidence integer,
  p_expected_value numeric
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_score integer := 50; -- Base score
BEGIN
  -- Factor 1: Outcome (40 points)
  IF p_outcome = 'win' THEN
    v_score := v_score + 40;
  ELSIF p_outcome = 'loss' THEN
    v_score := v_score + 10;
  ELSE
    v_score := v_score + 20; -- Breakeven
  END IF;

  -- Factor 2: Realized R:R (30 points)
  IF p_realized_rr >= 2.0 THEN
    v_score := v_score + 30;
  ELSIF p_realized_rr >= 1.5 THEN
    v_score := v_score + 20;
  ELSIF p_realized_rr >= 1.0 THEN
    v_score := v_score + 10;
  END IF;

  -- Factor 3: Confidence alignment (20 points)
  IF p_confidence >= 80 AND p_outcome = 'win' THEN
    v_score := v_score + 20;
  ELSIF p_confidence < 70 AND p_outcome = 'loss' THEN
    v_score := v_score - 10; -- Penalty
  END IF;

  -- Factor 4: EV alignment (10 points)
  IF p_expected_value IS NOT NULL AND p_expected_value > 0 THEN
    v_score := v_score + 10;
  END IF;

  -- Clamp to 0-100 range
  RETURN GREATEST(0, LEAST(100, v_score));
END;
$$;

-- ============================================================================
-- BACKFILL EXISTING DATA (OPTIONAL)
-- ============================================================================

-- Update existing records with default volatility regime
UPDATE ai_trade_analysis
SET volatility_regime = 'medium'
WHERE volatility_regime IS NULL
  AND created_at < NOW();

COMMENT ON TABLE ai_trade_analysis IS
  'Detailed post-trade analysis with advanced metrics for AI learning - Updated with EV and quality tracking';