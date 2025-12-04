/*
  # Add Omega-8 and Omega-9 Fields to Trade Journaling

  ## Changes

  Adds columns to support Omega-8 (OrderFlow) and Omega-9 (Hallucination Defense) tracking:

  ### Omega-8 (Dark Pool & Order Flow Specialist)
  - `omega8_liquidity_bias` - Liquidity condition assessment
  - `omega8_direction_support` - Order flow direction
  - `omega8_confidence` - Omega-8 confidence score
  - `omega8_reasoning` - Brief explanation

  ### Omega-9 (Hallucination Defense Specialist)
  - `omega9_pass` - Whether validation passed
  - `omega9_flags` - Array of validation flags
  - `omega9_confidence_adjustment` - Confidence delta applied
  - `omega9_corrections` - SL/TP/risk corrections made
  - `omega9_reasoning` - Validation explanation

  ## Tables Updated
  - `trade_history` - Live trade tracking
  - `backtest_trades` - Backtesting results
  - `ai_trade_journal` - AI decision journal

  ## Security
  - Existing RLS policies apply to new columns
*/

-- ============================================================================
-- ADD OMEGA-8 FIELDS TO trade_history
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'omega8_liquidity_bias'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN omega8_liquidity_bias text,
    ADD COLUMN omega8_direction_support text,
    ADD COLUMN omega8_confidence integer,
    ADD COLUMN omega8_reasoning text;
  END IF;
END $$;

-- ============================================================================
-- ADD OMEGA-9 FIELDS TO trade_history
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'omega9_pass'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN omega9_pass boolean,
    ADD COLUMN omega9_flags text[],
    ADD COLUMN omega9_confidence_adjustment integer,
    ADD COLUMN omega9_corrections jsonb,
    ADD COLUMN omega9_reasoning text;
  END IF;
END $$;

-- ============================================================================
-- ADD OMEGA-8 FIELDS TO backtest_trades
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_trades' AND column_name = 'omega8_liquidity_bias'
  ) THEN
    ALTER TABLE backtest_trades
    ADD COLUMN omega8_liquidity_bias text,
    ADD COLUMN omega8_direction_support text,
    ADD COLUMN omega8_confidence integer,
    ADD COLUMN omega8_reasoning text;
  END IF;
END $$;

-- ============================================================================
-- ADD OMEGA-9 FIELDS TO backtest_trades
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_trades' AND column_name = 'omega9_pass'
  ) THEN
    ALTER TABLE backtest_trades
    ADD COLUMN omega9_pass boolean,
    ADD COLUMN omega9_flags text[],
    ADD COLUMN omega9_confidence_adjustment integer,
    ADD COLUMN omega9_corrections jsonb,
    ADD COLUMN omega9_reasoning text;
  END IF;
END $$;

-- ============================================================================
-- ADD OMEGA-8 FIELDS TO ai_trade_journal
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'omega8_liquidity_bias'
  ) THEN
    ALTER TABLE ai_trade_journal
    ADD COLUMN omega8_liquidity_bias text,
    ADD COLUMN omega8_direction_support text,
    ADD COLUMN omega8_confidence integer,
    ADD COLUMN omega8_reasoning text;
  END IF;
END $$;

-- ============================================================================
-- ADD OMEGA-9 FIELDS TO ai_trade_journal
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'omega9_pass'
  ) THEN
    ALTER TABLE ai_trade_journal
    ADD COLUMN omega9_pass boolean,
    ADD COLUMN omega9_flags text[],
    ADD COLUMN omega9_confidence_adjustment integer,
    ADD COLUMN omega9_corrections jsonb,
    ADD COLUMN omega9_reasoning text;
  END IF;
END $$;

-- ============================================================================
-- CREATE INDEXES FOR QUERY PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_trade_history_omega8_bias
ON trade_history(omega8_liquidity_bias)
WHERE omega8_liquidity_bias IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trade_history_omega9_pass
ON trade_history(omega9_pass)
WHERE omega9_pass IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backtest_trades_omega9_pass
ON backtest_trades(omega9_pass)
WHERE omega9_pass IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN trade_history.omega8_liquidity_bias IS
'Omega-8 liquidity assessment: clean, stoprun_risk, reaccumulation, distribution';

COMMENT ON COLUMN trade_history.omega9_pass IS
'Omega-9 validation result: true if passed, false if blocked';

COMMENT ON COLUMN trade_history.omega9_corrections IS
'JSON object containing SL/TP/risk corrections applied by Omega-9';
