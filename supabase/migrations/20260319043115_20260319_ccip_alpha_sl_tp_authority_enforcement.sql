/*
  # Alpha SL/TP Authority Enforcement — SSOT Governance

  ## Title
  Wire Alpha's stop loss and take profit decisions directly into entry_intents

  ## Summary
  Alpha is the sole authority for stop loss and take profit values. Previously
  these were only stored in market_context (JSONB) and reconstructed at execution
  time, creating a path where other systems could fabricate fallback values.

  This migration adds dedicated typed columns to entry_intents so Alpha's exact
  decided values are persisted at intent creation (SSOT write point) and read back
  at execution time with no possibility of substitution.

  ## New Columns on entry_intents
  - `alpha_stop_loss` (numeric, NOT NULL) — Alpha's exact decided stop loss price. Required. No default.
  - `alpha_take_profit` (numeric, NOT NULL) — Alpha's exact decided take profit price. Required. No default.
  - `alpha_tp1_price` (numeric, nullable) — Alpha's conservative TP1 if dual-TP mode is active.
  - `alpha_tp2_price` (numeric, nullable) — Alpha's full TP2 target if dual-TP mode is active.

  ## Why NOT NULL on alpha_stop_loss and alpha_take_profit
  The database itself enforces the invariant: no entry intent may exist without
  Alpha having provided a stop loss and a take profit. Any system that attempts
  to insert an intent without these values receives a hard database error.
  This is the structural backstop for the SSOT governance requirement.

  ## Backward Compatibility
  Existing rows in entry_intents predate this column. To avoid breaking existing
  data, the NOT NULL constraint is applied with a DEFAULT of 0 for migration only,
  then the default is dropped. For existing rows, 0 signals "legacy record —
  pre-SSOT enforcement". New rows after this migration must always provide a real
  value or the insert will fail.

  NOTE: We use DEFAULT 0 temporarily only to satisfy the NOT NULL constraint for
  existing rows. The default is immediately dropped so future inserts without a
  value fail at the database layer, as required by governance.

  ## Security
  No RLS changes required — entry_intents RLS policies already exist.

  ## CCIP Reference
  CCIP-2026-0319B: Alpha sole authority for SL/TP — structural enforcement.
*/

DO $$
BEGIN
  -- alpha_stop_loss: Alpha's decided stop loss price (required, no fallback permitted)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'alpha_stop_loss'
  ) THEN
    ALTER TABLE entry_intents
      ADD COLUMN alpha_stop_loss numeric NOT NULL DEFAULT 0;
    -- Drop the default immediately so new inserts without this value fail hard
    ALTER TABLE entry_intents
      ALTER COLUMN alpha_stop_loss DROP DEFAULT;
  END IF;

  -- alpha_take_profit: Alpha's decided take profit price (required, no fallback permitted)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'alpha_take_profit'
  ) THEN
    ALTER TABLE entry_intents
      ADD COLUMN alpha_take_profit numeric NOT NULL DEFAULT 0;
    ALTER TABLE entry_intents
      ALTER COLUMN alpha_take_profit DROP DEFAULT;
  END IF;

  -- alpha_tp1_price: Alpha's conservative TP1 (dual-TP mode, nullable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'alpha_tp1_price'
  ) THEN
    ALTER TABLE entry_intents
      ADD COLUMN alpha_tp1_price numeric;
  END IF;

  -- alpha_tp2_price: Alpha's full TP2 target (dual-TP mode, nullable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'alpha_tp2_price'
  ) THEN
    ALTER TABLE entry_intents
      ADD COLUMN alpha_tp2_price numeric;
  END IF;
END $$;

COMMENT ON COLUMN entry_intents.alpha_stop_loss IS
  'SSOT: Alpha sole authority. Exact stop loss price decided by Alpha at scan time. '
  'Never computed, derived, or overwritten by any other system. '
  'NOT NULL enforced — no intent may exist without Alpha providing this value. '
  'CCIP-2026-0319B.';

COMMENT ON COLUMN entry_intents.alpha_take_profit IS
  'SSOT: Alpha sole authority. Exact take profit price decided by Alpha at scan time. '
  'Never computed, derived, or overwritten by any other system. '
  'NOT NULL enforced — no intent may exist without Alpha providing this value. '
  'CCIP-2026-0319B.';

COMMENT ON COLUMN entry_intents.alpha_tp1_price IS
  'SSOT: Alpha sole authority. Conservative TP1 target in dual-TP mode. '
  'Nullable — only present when Alpha explicitly provides a split-TP plan. '
  'CCIP-2026-0319B.';

COMMENT ON COLUMN entry_intents.alpha_tp2_price IS
  'SSOT: Alpha sole authority. Full TP2 target in dual-TP mode. '
  'Nullable — only present when Alpha explicitly provides a split-TP plan. '
  'CCIP-2026-0319B.';
