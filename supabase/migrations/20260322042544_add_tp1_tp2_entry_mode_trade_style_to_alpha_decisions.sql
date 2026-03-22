/*
  # Add Missing Governance Columns to alpha_decisions

  ## Summary
  The alpha_decisions table is missing four critical audit columns that Alpha
  produces on every trade decision but were never persisted to the database.
  This gap made it impossible to:
    1. Audit whether Alpha actually produced distinct TP1 and TP2 values
    2. Confirm which entry_mode Alpha chose (execute_now / wait_pullback / push_confirmation)
    3. Inspect the wait_condition zone Alpha specified for deferred entries
    4. Identify which trade style was active at decision time

  ## New Columns
  - `tp1_price` (numeric, nullable) — Alpha's conservative partial-profit target
  - `tp2_price` (numeric, nullable) — Alpha's full target (existing take_profit is the
    raw LLM output; tp2_price is the resolved value after executor processing)
  - `alpha_entry_mode` (text, nullable) — One of: execute_now, wait_pullback, push_confirmation
  - `alpha_wait_condition` (jsonb, nullable) — Alpha's deferred entry zone specification
  - `trade_style` (text, nullable) — Canonical style active at decision time

  ## Security
  No RLS changes — alpha_decisions inherits existing policies.

  ## CCIP Compliance
  CCIP-2026-0322A: SSOT audit trail gap closure.
  All columns are nullable to preserve backwards compatibility with existing records.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'tp1_price'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN tp1_price numeric;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'tp2_price'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN tp2_price numeric;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'alpha_entry_mode'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN alpha_entry_mode text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'alpha_wait_condition'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN alpha_wait_condition jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'trade_style'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN trade_style text;
  END IF;
END $$;
