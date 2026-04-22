/*
  # Add answer_sheet column to alpha_decisions

  ## Summary
  The application code in coordinator-alpha.ts extracts and inserts an `answer_sheet`
  JSONB object (Alpha's full Q1-Q12 checklist + extended fields like liquidity_sweep_read)
  into alpha_decisions on every scan cycle. The column was never added to the table,
  causing PGRST204 400 errors on every decision log attempt.

  ## Changes
  - `alpha_decisions`: Add `answer_sheet` column (jsonb, nullable)
    - Stores Alpha's complete reasoning audit trail: Q1-Q12 checklist answers,
      liquidity_sweep_read, Q12_market_phase, and any extended fields Alpha populates
    - Nullable — existing rows remain valid with null

  ## Notes
  - No default value: historical rows stay null, no backfill needed
  - No RLS change: column inherits existing table policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'answer_sheet'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN answer_sheet jsonb;
  END IF;
END $$;
