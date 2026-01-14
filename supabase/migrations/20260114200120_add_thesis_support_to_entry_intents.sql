/*
  # Add Thesis Support to Entry Intents

  ## Purpose
  Enhance entry_intents table with thesis-aware fields for better entry quality scoring.

  ## Changes
  - Add thesis field (enum)
  - Add style_intent field
  - Add execution_preference field
  - Add alpha_confidence field for EQS calibration
  - Add acceptable_profit_range for forensics

  ## Backward Compatibility
  - All new fields are nullable (backward compatible)
  - Existing intents will work without thesis data
  - Thesis-aware EQS only runs when thesis field is present

  ## Security
  - No RLS changes (inherits from existing policies)
*/

-- Add thesis field (nullable for backward compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'thesis'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN thesis text CHECK (thesis IN (
      'momentum_scalp',
      'liquidity_sweep_reversal',
      'trend_pullback',
      'breakout_continuation',
      'mean_reversion',
      'failed_move',
      'range_extreme'
    ));
  END IF;
END $$;

-- Add style_intent field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'style_intent'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN style_intent text CHECK (style_intent IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY'));
  END IF;
END $$;

-- Add execution_preference field
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'execution_preference'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN execution_preference text CHECK (execution_preference IN ('IMMEDIATE', 'WAIT_PULLBACK', 'WAIT_CONFIRMATION'));
  END IF;
END $$;

-- Add alpha_confidence field for EQS calibration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'alpha_confidence'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN alpha_confidence numeric CHECK (alpha_confidence >= 0 AND alpha_confidence <= 100);
  END IF;
END $$;

-- Add acceptable_profit_range for forensics tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'acceptable_profit_range'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN acceptable_profit_range jsonb DEFAULT '{}';
  END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_entry_intents_thesis ON entry_intents(thesis);
CREATE INDEX IF NOT EXISTS idx_entry_intents_execution_preference ON entry_intents(execution_preference);

-- Update comment to document thesis support
COMMENT ON COLUMN entry_intents.thesis IS 'Trade thesis type: determines entry quality scoring criteria';
COMMENT ON COLUMN entry_intents.style_intent IS 'Trading style: SCALP (20min-2hr), MICRO_INTRADAY (1hr-6hr), INTRADAY (2hr-10hr)';
COMMENT ON COLUMN entry_intents.execution_preference IS 'Entry urgency: IMMEDIATE, WAIT_PULLBACK, or WAIT_CONFIRMATION';
COMMENT ON COLUMN entry_intents.alpha_confidence IS 'Alpha confidence at intent creation (for EQS threshold adjustment)';
COMMENT ON COLUMN entry_intents.acceptable_profit_range IS 'Expected profit range: {minUSD, idealUSD} for forensics';
