/*
  # Fix goal_aware_lot_sizing_decisions decision_reason constraint
  
  ## Problem
  The frontend code uses decision_reason values 'risk_first_lot_deployed' and
  'hard_safety_cap_applied' which were added in the risk-first lot sizing refactor,
  but the database CHECK constraint was never updated to include them.
  
  This causes a 400 Bad Request on every lot sizing decision insert.
  
  ## Change
  - Drop old constraint: only allowed 5 legacy values
  - Add new constraint: includes all current values used by the coordinator
  
  ## Values
  New: 'risk_first_lot_deployed', 'hard_safety_cap_applied'
  Kept: 'fallback_risk_constraint', 'degraded_to_safe_lot',
        'goal_achievable_within_risk', 'goal_requires_more_risk',
        'market_cannot_deliver_goal'
*/

ALTER TABLE goal_aware_lot_sizing_decisions
  DROP CONSTRAINT IF EXISTS goal_aware_lot_sizing_decisions_decision_reason_check;

ALTER TABLE goal_aware_lot_sizing_decisions
  ADD CONSTRAINT goal_aware_lot_sizing_decisions_decision_reason_check
  CHECK (decision_reason = ANY (ARRAY[
    'risk_first_lot_deployed',
    'hard_safety_cap_applied',
    'goal_achievable_within_risk',
    'goal_requires_more_risk',
    'market_cannot_deliver_goal',
    'fallback_risk_constraint',
    'degraded_to_safe_lot'
  ]));
