/*
  # Add Alpha Confidence to Entry Intents

  1. Schema Change
    - Add `alpha_confidence` column to entry_intents
    - Stores Alpha's trade confidence (0-100) that justified the entry intent
    - Used for confidence-adjusted EQS threshold calculation

  2. Purpose
    - Enable dynamic EQS threshold relaxation for high-confidence trades
    - High confidence (85%+) allows EQS 50, medium (70%+) allows EQS 55, baseline (60%+) requires EQS 60
    - Professional sniper mentality: Execute high-conviction trades with entry timing flexibility
*/

-- Add alpha_confidence column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'alpha_confidence'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN alpha_confidence integer DEFAULT 60
    CHECK (alpha_confidence >= 0 AND alpha_confidence <= 100);

    COMMENT ON COLUMN entry_intents.alpha_confidence IS
    'Alpha trade confidence (0-100) that justified creating this entry intent. Used for confidence-adjusted EQS threshold calculation.';
  END IF;
END $$;
