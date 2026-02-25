/*
  # CCIP: Goal-Profit-First Lot Sizing Governance Fix

  ## Summary
  Fixes the fundamental lot-sizing inversion bug where the system was treating
  the user's PROFIT TARGET (goal) as a RISK BUDGET, causing catastrophically
  undersized positions.

  ## The Bug
  When a user selects "Aggressive 5%" on a $96,476 account:
  - goalAmount = $4,823 (5% of balance — the PROFIT they want to make)
  - dollar_risk stored in goal_sessions = $4,823
  - At execution: riskPercentageAllowed = $4,823 / $96,476 = 5%
  - Coordinator then caps lot at: $4,823 risk / (SL pips x $/pip) = tiny lot
  - Actual required lot to PROFIT $4,823 at 100pt TP = 0.48 lots
  - Result: user gets 0.07 lots instead of 0.48 — a 7x undershoot

  ## The Correct Mental Model
  - goal_amount = what the user wants to EARN (e.g. 5% of balance)
  - risk on any given trade = goal_amount / R:R ratio (implicit, not explicit)
  - For 2:1 trade: risk = $4,823 / 2 = $2,411 (2.5% of balance — well within reason)
  - Alpha sets the R:R; lot size is set to make the PROFIT TARGET, not the risk target

  ## Changes

  ### New Column: goal_sessions.risk_percentage
  - Stores the user's chosen percentage (e.g., 5.0 for "Aggressive")
  - SSOT: computed once at session creation from the risk_mode / percentage selection
  - Prevents drift caused by re-computing from dollar_risk / live_balance over time

  ### Audit Columns: goal_aware_lot_sizing_decisions
  - implied_rr_ratio: R:R of the trade (governance transparency)
  - profit_target_dollars: confirms profit-first sizing was applied
  - hard_safety_cap_applied: flags when lot was capped by safety ceiling

  ## Security
  - RLS: Users can only read their own goal_sessions (existing policy unchanged)
  - New columns: nullable, safe to backfill
  - No destructive operations
*/

-- Add risk_percentage column to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'risk_percentage'
  ) THEN
    ALTER TABLE goal_sessions
      ADD COLUMN risk_percentage numeric(5,2) DEFAULT NULL;

    COMMENT ON COLUMN goal_sessions.risk_percentage IS
      'User-selected profit target as percentage of account balance (e.g., 5.00 for Aggressive 5%). '
      'SSOT for lot sizing. Set at session creation, never mutated. '
      'Used by alpha-trade-executor to compute required lot: lot = goal_dollar / (tp_pips x $/pip_per_lot).';
  END IF;
END $$;

-- Backfill risk_percentage from existing risk_mode values for all sessions
-- Mapping: low=1.0, medium=3.0, high=5.0 (mirrors risk-percentage-mapping.ts)
UPDATE goal_sessions
SET risk_percentage = CASE
  WHEN risk_mode = 'high'   THEN 5.0
  WHEN risk_mode = 'medium' THEN 3.0
  WHEN risk_mode = 'low'    THEN 1.0
  ELSE 3.0
END
WHERE risk_percentage IS NULL;

-- Add governance audit columns to goal_aware_lot_sizing_decisions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_aware_lot_sizing_decisions' AND column_name = 'implied_rr_ratio'
  ) THEN
    ALTER TABLE goal_aware_lot_sizing_decisions
      ADD COLUMN implied_rr_ratio numeric(6,3) DEFAULT NULL;
    COMMENT ON COLUMN goal_aware_lot_sizing_decisions.implied_rr_ratio IS
      'R:R ratio (tp_pips / sl_pips). Governance record confirming profit-first sizing was used.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_aware_lot_sizing_decisions' AND column_name = 'profit_target_dollars'
  ) THEN
    ALTER TABLE goal_aware_lot_sizing_decisions
      ADD COLUMN profit_target_dollars numeric(12,2) DEFAULT NULL;
    COMMENT ON COLUMN goal_aware_lot_sizing_decisions.profit_target_dollars IS
      'Dollar profit targeted at TP (remaining_goal). Confirms profit-first sizing was applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_aware_lot_sizing_decisions' AND column_name = 'hard_safety_cap_applied'
  ) THEN
    ALTER TABLE goal_aware_lot_sizing_decisions
      ADD COLUMN hard_safety_cap_applied boolean DEFAULT false;
    COMMENT ON COLUMN goal_aware_lot_sizing_decisions.hard_safety_cap_applied IS
      'True when lot was capped because implied SL risk exceeded the hard safety ceiling (2x declared %).';
  END IF;
END $$;
