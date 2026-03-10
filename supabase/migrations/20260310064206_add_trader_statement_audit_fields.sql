/*
  # Add Trader Statement Audit Fields to Alpha Decisions

  ## Summary
  CCIP-2026-0310A: Adds mandatory audit output fields to the alpha_decisions table
  to support full trade reasoning traceability.

  ## New Columns Added to alpha_decisions
  - `trader_statement` (text, nullable) — Alpha's full reasoning in trader voice, min 80 words for BUY/SELL
  - `sl_structural_reference` (text, nullable) — Named structural reference for SL placement including price, timeframe, and invalidation reason
  - `tp_structural_reference` (text, nullable) — Named structural reference for TP placement including zone name, price, and R:R
  - `estimated_duration_minutes` (text, nullable) — Alpha's estimate of trade duration with behavioral fit assessment
  - `edge_summary` (text, nullable) — 1-2 sentence statement of why this trade has structural probability advantage

  ## Notes
  - All columns are nullable to preserve backwards compatibility with existing records
  - No DEFAULT values on these columns per DATABASE DEFAULT VALUE POLICY (GOVERNANCE_DECISIONS.md 2026-02-02)
  - These fields are populated by the LLM output parser and stored for audit trail purposes
  - Nullable is correct here: legacy trades and NO_TRADE decisions will not have these fields
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'trader_statement'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN trader_statement text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'sl_structural_reference'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN sl_structural_reference text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'tp_structural_reference'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN tp_structural_reference text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'estimated_duration_minutes'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN estimated_duration_minutes text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'edge_summary'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN edge_summary text;
  END IF;
END $$;
