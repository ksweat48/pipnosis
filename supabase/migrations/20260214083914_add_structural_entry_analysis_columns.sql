/*
  # Add Structural Entry Analysis Columns to entry_intents

  ## Purpose
  Stores the Entry Structure Analyzer's verdict so the Entry Advisory UI
  can show whether Alpha's entry is at a structurally sound level (support/resistance)
  or if the user should wait for a pullback to a better entry price.

  ## New Columns on `entry_intents`
    - `structural_verdict` (text, nullable) - 'OPTIMAL_ENTRY' or 'WAIT_FOR_PULLBACK'
    - `structural_level_price` (numeric, nullable) - The S/R level backing the verdict
    - `structural_level_type` (text, nullable) - 'support' or 'resistance'
    - `structural_level_strength` (numeric, nullable) - 0-1 strength score
    - `structural_level_touches` (integer, nullable) - Number of times price tested this level
    - `pullback_target_price` (numeric, nullable) - Recommended pullback entry price
    - `pullback_improvement_pips` (numeric, nullable) - Pips improvement by waiting
    - `pullback_reached_at` (timestamptz, nullable) - When price hit pullback target

  ## Security
    - No new tables, no RLS changes needed (existing entry_intents RLS applies)

  ## SSOT Compliance
    - These columns are populated by EntryStructureAnalyzer via AlphaTradeExecutor
    - Single authority: EntryStructureAnalyzer is the ONLY writer of these fields
    - EntryPriceMonitor is the ONLY consumer for UI display
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'structural_verdict'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN structural_verdict text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'structural_level_price'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN structural_level_price numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'structural_level_type'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN structural_level_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'structural_level_strength'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN structural_level_strength numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'structural_level_touches'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN structural_level_touches integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'pullback_target_price'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN pullback_target_price numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'pullback_improvement_pips'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN pullback_improvement_pips numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'pullback_reached_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN pullback_reached_at timestamptz;
  END IF;
END $$;
