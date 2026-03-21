/*
  # CCIP-ALPHA-GOV-001: Add Alpha Governance Fields to Trades Table

  ## Summary
  Adds nullable audit columns to the `goal_session_trades` table to persist
  Alpha's per-trade governance decisions from the extended `AlphaOutputFormat`
  and `AlphaTradeManagement` schemas.

  ## New Columns on goal_session_trades

  ### R:R and TP Governance
  - `rr_ceiling_override` (numeric, nullable) — Alpha's per-trade R:R ceiling override.
    When set, replaces the static style ceiling (SCALP=2.0, MICRO=2.0, INTRADAY=3.0).
  - `tp_multiplier_override` (numeric, nullable) — Alpha's per-trade ATR TP multiplier.
    When set, replaces the static 3.0x ATR base in calculateDynamicMultipliers().
  - `tp_structural_justification` (text, nullable) — Alpha's plain-English explanation
    for why the TP level is placed at a specific structural reference (e.g. swing high,
    demand zone, order block).

  ### Spread Estimate
  - `spread_estimate_pips` (numeric, nullable) — Alpha's per-trade spread estimate in pips.
    When set, supersedes the static TYPICAL_SPREADS_PIPS table on the next scan cycle.

  ### Trade Management (TP1 Actions)
  - `tp1_action` (text, nullable) — Structured TP1 action: 'move_sl_to_breakeven' |
    'move_sl_to_level' | 'hold_sl'. Replaces the deprecated boolean sl_to_breakeven_after_tp1.
  - `tp1_sl_level` (numeric, nullable) — Absolute price for SL after TP1 hit.
    Required when tp1_action = 'move_sl_to_level'.
  - `tp1_condition` (text, nullable) — Optional named market condition that triggered TP1 action.

  ## Security
  - No RLS changes required (columns inherit existing table policies)
  - No new tables created

  ## Notes
  - All columns are nullable to preserve backward compatibility with existing trade records
  - tp1_action uses a CHECK constraint to enforce valid enum values
  - This migration is safe to run on a live database (only ALTER TABLE ADD COLUMN)
*/

DO $$
BEGIN
  -- rr_ceiling_override
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'rr_ceiling_override'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN rr_ceiling_override numeric;
  END IF;

  -- tp_multiplier_override
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp_multiplier_override'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp_multiplier_override numeric;
  END IF;

  -- tp_structural_justification
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp_structural_justification'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp_structural_justification text;
  END IF;

  -- spread_estimate_pips
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'spread_estimate_pips'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN spread_estimate_pips numeric;
  END IF;

  -- tp1_action
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_action'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_action text
      CHECK (tp1_action IN ('move_sl_to_breakeven', 'move_sl_to_level', 'hold_sl'));
  END IF;

  -- tp1_sl_level
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_sl_level'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_sl_level numeric;
  END IF;

  -- tp1_condition
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_condition'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_condition text;
  END IF;
END $$;
