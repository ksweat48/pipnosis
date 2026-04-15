/*
  # CCIP-ALPHA-HUNTER-LAW: Alpha Permanent Aggressiveness Governance

  ## Summary
  Documents and enforces the architectural law that Alpha's hunting aggressiveness is
  permanently HIGH and is never derived from the user's dollar risk amount.

  ## Problem Corrected
  The user's dollar risk flowed: dollarRisk/balance → riskMode → formatRiskProfileForLLM(riskMode)
  → Alpha's system prompt AND TraderScore.riskTolerance (0.3/0.5/0.8).
  Low dollar risk → LOW riskMode → patient/H1/H4/pullback-only Alpha. Fatal.

  ## Law
  - Dollar risk → riskMode → ProfessionalRiskManager (position sizing ONLY)
  - Alpha hunting profile: ALWAYS 'high' — immediate entry, M5/M15, breakout/momentum 0.9
  - TraderScore.riskTolerance: ALWAYS 0.8 (permanent hunter posture)
  - CCIP ID: CCIP-ALPHA-HUNTER-LAW-20260415

  ## Changes
  - Records this architectural law in governance_change_log
  - No table structure changes required; fix is applied in application layer
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
)
VALUES (
  'alpha_execution_policy',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'riskTolerance_derivation', 'high=0.8 / medium=0.5 / low=0.3 — varied by dollar risk',
    'hunting_profile', 'formatRiskProfileForLLM(riskMode) — suppressed by low dollar risk',
    'fatal_flaw', 'Low dollar risk suppressed Alpha to patient/H1/H4/pullback-only hunting'
  ),
  jsonb_build_object(
    'riskTolerance_derivation', 'ALWAYS 0.8 — permanent hunter posture',
    'hunting_profile', 'formatRiskProfileForLLM(high) — always aggressive regardless of dollar risk',
    'law', 'Dollar risk = position sizing only. Alpha hunting = always HIGH aggressiveness.',
    'ccip_id', 'CCIP-ALPHA-HUNTER-LAW-20260415'
  ),
  'CCIP-ALPHA-HUNTER-LAW-20260415: Alpha is a permanent hunter on every style, session, and market phase. Dollar risk never suppresses hunting aggressiveness. Fatal coupling removed.'
);
