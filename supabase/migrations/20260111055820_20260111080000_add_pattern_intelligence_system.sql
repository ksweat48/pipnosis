/*
  # Multi-Timeframe Pattern Intelligence System

  1. New Columns
    - Pattern detection results for HTF/MTF/LTF
    - Intent classification and alignment scores
    - Confidence adjustments from patterns
    - Liquidity targets and invalidation points

  2. Pattern Performance Views
    - Track effectiveness of different pattern types
    - Measure alignment score impact on win rate
    - Analyze confidence adjustment accuracy

  3. Security
    - RLS policies inherited from alpha_decisions
    - No additional permissions required

  4. Performance
    - Indexes for pattern analysis queries
*/

-- Add HTF pattern fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'htf_pattern'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN htf_pattern text,
    ADD COLUMN htf_intent text,
    ADD COLUMN htf_pattern_confidence numeric DEFAULT 0;
  END IF;
END $$;

-- Add MTF pattern fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'mtf_pattern'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN mtf_pattern text,
    ADD COLUMN mtf_intent text,
    ADD COLUMN mtf_pattern_confidence numeric DEFAULT 0;
  END IF;
END $$;

-- Add LTF pattern fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'ltf_pattern'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN ltf_pattern text,
    ADD COLUMN ltf_intent text,
    ADD COLUMN ltf_pattern_confidence numeric DEFAULT 0;
  END IF;
END $$;

-- Add pattern alignment fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'pattern_alignment_score'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN pattern_alignment_score integer DEFAULT 0,
    ADD COLUMN pattern_overall_intent text,
    ADD COLUMN pattern_direction_bias text,
    ADD COLUMN pattern_direction_aligned boolean DEFAULT false;
  END IF;
END $$;

-- Add pattern confidence adjustment tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'pattern_confidence_boosts'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN pattern_confidence_boosts jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN pattern_confidence_penalties jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN pattern_total_adjustment numeric DEFAULT 0,
    ADD COLUMN pattern_cap_applied boolean DEFAULT false;
  END IF;
END $$;

-- Add pattern liquidity targets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'pattern_liquidity_targets'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN pattern_liquidity_targets jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN pattern_invalidation_price numeric,
    ADD COLUMN pattern_invalidation_reasoning text;
  END IF;
END $$;

-- Add pattern warnings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'pattern_warnings'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD COLUMN pattern_warnings jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add constraints for pattern types (13 approved patterns)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_htf_pattern_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_htf_pattern_check
    CHECK (htf_pattern IS NULL OR htf_pattern IN (
      'flag',
      'pennant',
      'channel_continuation',
      'pre_break_compression',
      'break_retest',
      'sfp_sweep',
      'quasimodo',
      'head_shoulders',
      'exhaustion_wedge',
      'range_liquidity_box',
      'equal_highs_lows',
      'liquidity_vacuum',
      'stop_hunt_expansion'
    ));
  END IF;
END $$;

-- Same constraint for MTF and LTF
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_mtf_pattern_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_mtf_pattern_check
    CHECK (mtf_pattern IS NULL OR mtf_pattern IN (
      'flag', 'pennant', 'channel_continuation', 'pre_break_compression', 'break_retest',
      'sfp_sweep', 'quasimodo', 'head_shoulders', 'exhaustion_wedge',
      'range_liquidity_box', 'equal_highs_lows', 'liquidity_vacuum', 'stop_hunt_expansion'
    ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_ltf_pattern_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_ltf_pattern_check
    CHECK (ltf_pattern IS NULL OR ltf_pattern IN (
      'flag', 'pennant', 'channel_continuation', 'pre_break_compression', 'break_retest',
      'sfp_sweep', 'quasimodo', 'head_shoulders', 'exhaustion_wedge',
      'range_liquidity_box', 'equal_highs_lows', 'liquidity_vacuum', 'stop_hunt_expansion'
    ));
  END IF;
END $$;

-- Add constraints for intent types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_htf_intent_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_htf_intent_check
    CHECK (htf_intent IS NULL OR htf_intent IN (
      'continuation_likely',
      'expansion_likely',
      'reversal_likely',
      'trap_likely',
      'chop_likely'
    ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_mtf_intent_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_mtf_intent_check
    CHECK (mtf_intent IS NULL OR mtf_intent IN (
      'continuation_likely', 'expansion_likely', 'reversal_likely', 'trap_likely', 'chop_likely'
    ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_ltf_intent_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_ltf_intent_check
    CHECK (ltf_intent IS NULL OR ltf_intent IN (
      'continuation_likely', 'expansion_likely', 'reversal_likely', 'trap_likely', 'chop_likely'
    ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_pattern_overall_intent_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_pattern_overall_intent_check
    CHECK (pattern_overall_intent IS NULL OR pattern_overall_intent IN (
      'continuation_likely', 'expansion_likely', 'reversal_likely', 'trap_likely', 'chop_likely'
    ));
  END IF;
END $$;

-- Add constraint for alignment score (0-3)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_pattern_alignment_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_pattern_alignment_check
    CHECK (pattern_alignment_score >= 0 AND pattern_alignment_score <= 3);
  END IF;
END $$;

-- Add constraint for direction bias
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alpha_decisions_pattern_direction_bias_check'
  ) THEN
    ALTER TABLE alpha_decisions
    ADD CONSTRAINT alpha_decisions_pattern_direction_bias_check
    CHECK (pattern_direction_bias IS NULL OR pattern_direction_bias IN ('bullish', 'bearish', 'neutral'));
  END IF;
END $$;

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_htf_pattern
ON alpha_decisions(htf_pattern)
WHERE htf_pattern IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_pattern_alignment
ON alpha_decisions(pattern_alignment_score)
WHERE pattern_alignment_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_pattern_overall_intent
ON alpha_decisions(pattern_overall_intent)
WHERE pattern_overall_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_pattern_direction_aligned
ON alpha_decisions(pattern_direction_aligned)
WHERE pattern_direction_aligned = true;

-- Create pattern performance view
CREATE OR REPLACE VIEW alpha_pattern_performance AS
SELECT
  htf_pattern,
  htf_intent,
  COUNT(*) as occurrence_count,
  AVG(confidence) as avg_confidence,
  AVG(pattern_total_adjustment) as avg_confidence_adjustment,
  COUNT(CASE WHEN pattern_alignment_score = 3 THEN 1 END) as perfect_alignment_count,
  COUNT(CASE WHEN pattern_direction_aligned THEN 1 END) as direction_aligned_count,
  COUNT(CASE WHEN action IN ('BUY', 'SELL') THEN 1 END) as trade_count
FROM alpha_decisions
WHERE htf_pattern IS NOT NULL
GROUP BY htf_pattern, htf_intent
ORDER BY occurrence_count DESC;

-- Create pattern alignment analysis view
CREATE OR REPLACE VIEW alpha_pattern_alignment_analysis AS
SELECT
  pattern_alignment_score,
  COUNT(*) as decision_count,
  AVG(confidence) as avg_confidence,
  AVG(pattern_total_adjustment) as avg_adjustment,
  COUNT(CASE WHEN pattern_direction_aligned THEN 1 END) as direction_aligned_count,
  COUNT(CASE WHEN action IN ('BUY', 'SELL') THEN 1 END) as trade_count
FROM alpha_decisions
WHERE pattern_alignment_score IS NOT NULL
GROUP BY pattern_alignment_score
ORDER BY pattern_alignment_score DESC;

-- Create pattern intent effectiveness view
CREATE OR REPLACE VIEW alpha_pattern_intent_effectiveness AS
SELECT
  pattern_overall_intent,
  pattern_direction_bias,
  COUNT(*) as occurrence_count,
  AVG(confidence) as avg_confidence,
  COUNT(CASE WHEN pattern_direction_aligned THEN 1 END) as aligned_count,
  COUNT(CASE WHEN pattern_cap_applied THEN 1 END) as cap_applied_count,
  AVG(jsonb_array_length(pattern_warnings)) as avg_warnings_per_decision
FROM alpha_decisions
WHERE pattern_overall_intent IS NOT NULL
GROUP BY pattern_overall_intent, pattern_direction_bias
ORDER BY occurrence_count DESC;

-- Grant access to views
GRANT SELECT ON alpha_pattern_performance TO authenticated;
GRANT SELECT ON alpha_pattern_alignment_analysis TO authenticated;
GRANT SELECT ON alpha_pattern_intent_effectiveness TO authenticated;

-- Add helpful comments
COMMENT ON COLUMN alpha_decisions.htf_pattern IS 'HTF (D1/H4) pattern type: campaign intent detection';
COMMENT ON COLUMN alpha_decisions.htf_intent IS 'HTF market intent classification (5 types)';
COMMENT ON COLUMN alpha_decisions.mtf_pattern IS 'MTF (H1/M30) pattern type: expansion preparation detection';
COMMENT ON COLUMN alpha_decisions.mtf_intent IS 'MTF market intent classification';
COMMENT ON COLUMN alpha_decisions.ltf_pattern IS 'LTF (M15/M5) pattern type: execution timing detection';
COMMENT ON COLUMN alpha_decisions.ltf_intent IS 'LTF market intent classification';
COMMENT ON COLUMN alpha_decisions.pattern_alignment_score IS 'Pattern alignment across timeframes (0-3)';
COMMENT ON COLUMN alpha_decisions.pattern_overall_intent IS 'Overall market intent from multi-timeframe analysis';
COMMENT ON COLUMN alpha_decisions.pattern_direction_bias IS 'Directional bias from pattern analysis';
COMMENT ON COLUMN alpha_decisions.pattern_confidence_boosts IS 'JSON array of confidence boosts from patterns';
COMMENT ON COLUMN alpha_decisions.pattern_confidence_penalties IS 'JSON array of confidence penalties from patterns';
COMMENT ON COLUMN alpha_decisions.pattern_liquidity_targets IS 'JSON array of pattern-identified liquidity targets';
COMMENT ON COLUMN alpha_decisions.pattern_invalidation_price IS 'Price level where pattern setup is invalidated';
