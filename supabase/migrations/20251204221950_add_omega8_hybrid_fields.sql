/*
  # Add Omega-8 Hybrid Fields to Trade Tables

  1. New Columns
    - `omega8_used_llm` - Whether LLM refinement was used (boolean)
    - `omega8_deterministic_bias` - Initial deterministic bias
    - `omega8_deterministic_confidence` - Deterministic confidence score
    - `omega8_llm_reason` - LLM refinement reasoning (if used)
    - `omega8_patterns` - JSON of detected patterns

  2. Purpose
    - Track hybrid decision-making process
    - Measure LLM usage percentage (target: 20-30%)
    - Analyze when LLM helps vs hurts performance
    - Enable A/B testing of confidence thresholds

  3. Tables Updated
    - trade_history
    - backtest_trades
    - ai_trade_journal
*/

-- ============================================================================
-- ADD HYBRID FIELDS TO trade_history
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'omega8_used_llm'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN omega8_used_llm boolean DEFAULT false,
    ADD COLUMN omega8_deterministic_bias text,
    ADD COLUMN omega8_deterministic_confidence integer,
    ADD COLUMN omega8_llm_reason text,
    ADD COLUMN omega8_patterns jsonb;
  END IF;
END $$;

-- ============================================================================
-- ADD HYBRID FIELDS TO backtest_trades
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_trades' AND column_name = 'omega8_used_llm'
  ) THEN
    ALTER TABLE backtest_trades
    ADD COLUMN omega8_used_llm boolean DEFAULT false,
    ADD COLUMN omega8_deterministic_bias text,
    ADD COLUMN omega8_deterministic_confidence integer,
    ADD COLUMN omega8_llm_reason text,
    ADD COLUMN omega8_patterns jsonb;
  END IF;
END $$;

-- ============================================================================
-- ADD HYBRID FIELDS TO ai_trade_journal
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'omega8_used_llm'
  ) THEN
    ALTER TABLE ai_trade_journal
    ADD COLUMN omega8_used_llm boolean DEFAULT false,
    ADD COLUMN omega8_deterministic_bias text,
    ADD COLUMN omega8_deterministic_confidence integer,
    ADD COLUMN omega8_llm_reason text,
    ADD COLUMN omega8_patterns jsonb;
  END IF;
END $$;

-- ============================================================================
-- CREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trade_history_omega8_llm_usage
ON trade_history(omega8_used_llm)
WHERE omega8_used_llm IS TRUE;

CREATE INDEX IF NOT EXISTS idx_backtest_trades_omega8_llm_usage
ON backtest_trades(omega8_used_llm)
WHERE omega8_used_llm IS TRUE;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN trade_history.omega8_used_llm IS
'True if LLM refinement was called (target: 20-30% of cases for cost optimization)';

COMMENT ON COLUMN trade_history.omega8_deterministic_bias IS
'Initial bias from deterministic pattern scoring before LLM refinement';

COMMENT ON COLUMN trade_history.omega8_patterns IS
'JSON object containing detected orderflow patterns (sweeps, FVG, volume, etc)';
