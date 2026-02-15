/*
  # CCIP-2026-02-15: SSOT Compliance - Trade Flow Audit Fixes

  ## Summary
  Adds missing column to alpha_decisions table discovered during trade flow SSOT audit.
  The alpha_learning_tracker has been sending `trader_personality` data since its creation,
  but the column was never added to the database schema, causing silent insert failures
  that dropped learning personality correlation data.

  ## Changes
  1. New Columns
    - `alpha_decisions.trader_personality` (text, nullable) - Captures the AI trader
      personality active at decision time for learning correlation analysis

  2. Security
    - No RLS changes needed (alpha_decisions already has proper RLS policies)

  ## CCIP Governance
  - Root cause: Schema mismatch between alpha-learning-tracker.ts and alpha_decisions table
  - Impact: trader_personality was being silently dropped on every insert
  - Fix: Add column to match SSOT tracker interface (AlphaDecisionLog)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'trader_personality'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN trader_personality text;
  END IF;
END $$;
