/*
  # Risk-First Lot Sizing Governance — Column Comment Update

  ## Summary
  Updates database column comments to correctly describe the risk model after
  reverting from "profit-first" to "risk-first" (institutional) lot sizing.

  ## Why This Change
  The previous model sized lots to hit a profit target (profit-first). This is
  incorrect institutional practice. The correct model is:

    1. riskPercentage = the % of balance the user is willing to LOSE at SL
    2. lot = (balance × riskPct%) / (sl_pips × $/pip_per_lot)
    3. Accept whatever profit Alpha's TP delivers at that lot size

  The goal (target_value) remains as a session-level progress tracker only.
  It is NOT a per-trade sizing driver.

  ## Column Changes (comment-only, no schema change)
  - goal_sessions.risk_percentage: re-described as "SL risk tolerance %" not "profit-target %"
  - goal_aware_lot_sizing_decisions.profit_target_dollars: re-described as "remaining goal
    at time of decision (informational, not a sizing driver)"
  - goal_aware_lot_sizing_decisions.hard_safety_cap_applied: re-described as always false
    under risk-first model (kept for audit schema compatibility)

  ## Security
  - No schema changes, no RLS changes
  - Comment-only migration — fully non-destructive
*/

COMMENT ON COLUMN goal_sessions.risk_percentage IS
  'SL risk tolerance as a percentage of account balance '
  '(e.g., 5.00 = user accepts losing 5% of balance if stop loss is hit). '
  'SSOT for lot sizing. Set at session creation, never mutated. '
  'Lot sizing formula: lot = (balance × risk_percentage / 100) / (sl_pips × $/pip_per_lot). '
  'The goal (target_value) is a session progress tracker — it does NOT drive lot sizing.';

COMMENT ON COLUMN goal_aware_lot_sizing_decisions.profit_target_dollars IS
  'Remaining goal amount at time of decision (session progress context). '
  'Informational only — NOT used to compute lot size under the risk-first model. '
  'Lot size is determined solely by risk_percentage_allowed and the SL distance.';

COMMENT ON COLUMN goal_aware_lot_sizing_decisions.hard_safety_cap_applied IS
  'Under the risk-first model this is always false. '
  'Retained for audit schema compatibility. '
  'Previously used under the deprecated profit-first model to flag when a '
  'profit-chasing lot exceeded a 2x safety ceiling.';
