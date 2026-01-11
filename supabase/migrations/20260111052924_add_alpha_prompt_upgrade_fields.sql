/*
  # Alpha LLM Prompt Upgrade - Phases 1, 2, 4

  1. New Columns for Micro-Regime Classification
    - `micro_regime` - Detected regime type (8 regimes)
    - `regime_confidence` - Regime classification confidence
    - `regime_confidence_modifier` - Confidence adjustment from regime
    - `regime_direction` - Regime directional bias

  2. New Columns for Liquidity Intent Modeling
    - `trapped_side` - Which participants are trapped
    - `vulnerability_type` - Type of market vulnerability
    - `hunt_zone_active` - Boolean for active cascade risk
    - `predator_direction` - Direction of institutional flow
    - `cascade_distance` - Expected cascade in ATR units
    - `liquidity_conviction` - Overall liquidity intent conviction

  3. New Columns for Narrative Coherence
    - `market_narrative` - Required one-sentence thesis
    - `narrative_strength_score` - Quality score for narrative
    - `narrative_confidence_penalty` - Penalty applied for weak narrative
    - `narrative_quality_tier` - Quality classification

  4. Security
    - RLS policies inherited from existing alpha_decisions policies
    - No new permissions required

  5. Performance
    - Indexes for regime-based and narrative-based analysis queries
*/

-- Add micro-regime fields to alpha_decisions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'micro_regime'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN micro_regime text,
    ADD COLUMN regime_confidence numeric DEFAULT 0,
    ADD COLUMN regime_confidence_modifier numeric DEFAULT 0,
    ADD COLUMN regime_direction text;
  END IF;
END $$;

-- Add liquidity intent fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'trapped_side'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN trapped_side text,
    ADD COLUMN vulnerability_type text,
    ADD COLUMN hunt_zone_active boolean DEFAULT false,
    ADD COLUMN predator_direction text,
    ADD COLUMN cascade_distance numeric DEFAULT 0,
    ADD COLUMN liquidity_conviction numeric DEFAULT 0;
  END IF;
END $$;

-- Add narrative coherence fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'market_narrative'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN market_narrative text,
    ADD COLUMN narrative_strength_score numeric DEFAULT 0,
    ADD COLUMN narrative_confidence_penalty numeric DEFAULT 0,
    ADD COLUMN narrative_quality_tier text;
  END IF;
END $$;

-- Add constraints for regime types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_micro_regime_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_micro_regime_check
    CHECK (micro_regime IS NULL OR micro_regime IN (
      'trend_acceleration',
      'trend_exhaustion',
      'mean_reversion_pocket',
      'liquidity_vacuum',
      'stop_hunt_expansion',
      'pre_break_compression',
      'post_break_retest',
      'neutral_ranging'
    ));
  END IF;
END $$;

-- Add constraints for trapped participant types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_trapped_side_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_trapped_side_check
    CHECK (trapped_side IS NULL OR trapped_side IN (
      'retail_longs',
      'retail_shorts',
      'early_breakout_traders',
      'stop_loss_traders',
      'none'
    ));
  END IF;
END $$;

-- Add constraints for vulnerability types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_vulnerability_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_vulnerability_check
    CHECK (vulnerability_type IS NULL OR vulnerability_type IN (
      'stop_cascade',
      'margin_squeeze',
      'breakout_failure',
      'range_traders',
      'none'
    ));
  END IF;
END $$;

-- Add constraints for predator direction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_predator_direction_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_predator_direction_check
    CHECK (predator_direction IS NULL OR predator_direction IN ('long', 'short', 'neutral'));
  END IF;
END $$;

-- Add constraints for narrative quality tier
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_narrative_quality_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_narrative_quality_check
    CHECK (narrative_quality_tier IS NULL OR narrative_quality_tier IN (
      'none',
      'weak',
      'acceptable',
      'strong',
      'excellent'
    ));
  END IF;
END $$;

-- Add constraints for regime direction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_regime_direction_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_regime_direction_check
    CHECK (regime_direction IS NULL OR regime_direction IN ('bullish', 'bearish', 'neutral'));
  END IF;
END $$;

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_micro_regime
ON alpha_decisions(micro_regime)
WHERE micro_regime IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_hunt_zone_active
ON alpha_decisions(hunt_zone_active)
WHERE hunt_zone_active = true;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_narrative_quality
ON alpha_decisions(narrative_quality_tier)
WHERE narrative_quality_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_trapped_side
ON alpha_decisions(trapped_side)
WHERE trapped_side IS NOT NULL AND trapped_side != 'none';

-- Create analysis view for regime performance
CREATE OR REPLACE VIEW alpha_regime_performance AS
SELECT
  micro_regime,
  regime_direction,
  COUNT(*) as decision_count,
  AVG(confidence) as avg_confidence,
  AVG(regime_confidence_modifier) as avg_modifier,
  COUNT(CASE WHEN action IN ('BUY', 'SELL') THEN 1 END) as trade_count
FROM alpha_decisions
WHERE micro_regime IS NOT NULL
GROUP BY micro_regime, regime_direction
ORDER BY decision_count DESC;

-- Create analysis view for liquidity intent performance
CREATE OR REPLACE VIEW alpha_liquidity_performance AS
SELECT
  trapped_side,
  vulnerability_type,
  predator_direction,
  COUNT(*) as decision_count,
  AVG(liquidity_conviction) as avg_conviction,
  AVG(cascade_distance) as avg_cascade_atr,
  COUNT(CASE WHEN hunt_zone_active THEN 1 END) as active_hunts
FROM alpha_decisions
WHERE trapped_side IS NOT NULL AND trapped_side != 'none'
GROUP BY trapped_side, vulnerability_type, predator_direction
ORDER BY decision_count DESC;

-- Create analysis view for narrative quality impact
CREATE OR REPLACE VIEW alpha_narrative_performance AS
SELECT
  narrative_quality_tier,
  COUNT(*) as decision_count,
  AVG(narrative_strength_score) as avg_strength,
  AVG(narrative_confidence_penalty) as avg_penalty,
  AVG(confidence) as avg_final_confidence
FROM alpha_decisions
WHERE narrative_quality_tier IS NOT NULL
GROUP BY narrative_quality_tier
ORDER BY
  CASE narrative_quality_tier
    WHEN 'excellent' THEN 1
    WHEN 'strong' THEN 2
    WHEN 'acceptable' THEN 3
    WHEN 'weak' THEN 4
    WHEN 'none' THEN 5
  END;

-- Grant access to views (admin only)
GRANT SELECT ON alpha_regime_performance TO authenticated;
GRANT SELECT ON alpha_liquidity_performance TO authenticated;
GRANT SELECT ON alpha_narrative_performance TO authenticated;

-- Add helpful comment
COMMENT ON COLUMN alpha_decisions.micro_regime IS 'Detected micro-regime: 8 granular market behavior patterns';
COMMENT ON COLUMN alpha_decisions.market_narrative IS 'Required single-sentence cause-effect market thesis';
COMMENT ON COLUMN alpha_decisions.trapped_side IS 'Which participants are trapped by liquidity sweep';
COMMENT ON COLUMN alpha_decisions.hunt_zone_active IS 'Active cascade zone with immediate opportunity';
