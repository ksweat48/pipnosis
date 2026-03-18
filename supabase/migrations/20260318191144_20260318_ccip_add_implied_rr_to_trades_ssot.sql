/*
  # Add implied_rr_ratio to goal_session_trades (SSOT)

  ## Purpose
  The implied R:R ratio for a trade is calculated once by goal-aware-lot-sizing-coordinator
  at trade creation time. Previously it was only stored in the audit table
  (goal_aware_lot_sizing_decisions.implied_rr_ratio). The trade row itself had no direct access,
  forcing the UI to join or re-calculate.

  This migration adds `implied_rr_ratio` directly to `goal_session_trades` as the SSOT for
  per-trade R:R. The coordinator already computes it (tp_pips / sl_pips). The executor
  writes it once and it is immutable thereafter (same governance contract as entry_price, stop_loss).

  ## Changes
  - `goal_session_trades.implied_rr_ratio` (numeric, nullable): The R:R ratio at trade creation.
    NULL means the trade pre-dates this column or the coordinator was unavailable (fallback path).

  ## Security
  - No RLS changes needed: this column inherits the existing table RLS policies.
    goal_session_trades already has per-user SELECT/INSERT/UPDATE/DELETE policies.

  ## Governance
  - SSOT: Written once by alpha-trade-executor.ts at trade creation. Never updated.
  - CCIP: Column named after the coordinator field (implied_rr_ratio) for traceability.
  - No data backfill: pre-existing trades remain NULL (acceptable — display falls back gracefully).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
      AND column_name = 'implied_rr_ratio'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN implied_rr_ratio numeric DEFAULT NULL;
  END IF;
END $$;
