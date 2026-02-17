/*
  # CCIP: Alpha Sole Trade Authority -- Advisory-Only Penalties Governance

  ## Summary
  Architectural correction to enforce Alpha as the sole trade authority within arena walls.
  All confidence penalty systems (adversarial, regime, session, etc.) are now advisory-only.
  Additionally tunes three arena wall parameters for SCALP feasibility.

  ## Changes

  ### 1. Confidence Engine -- Advisory Only (CRITICAL FIX)
  - All domain penalties are calculated and logged but do NOT reduce Alpha's execution confidence
  - Alpha's raw confidence + rewards = final execution confidence for threshold gating
  - advisory_adjusted_confidence field added to audit trail for analytics
  - Files: confidence-calculation-engine.ts, alpha-omega-orchestrator.ts

  ### 2. ATR Noise Floor Multiplier Reduced (1.25x to 1.15x)
  - Lowers SL noise floor by ~1-2 pips, 1.15x ATR still conservative
  - File: risk-aware-stop-calculator.ts

  ### 3. SCALP TP Minimum Reduced (15 to 12 pips)
  - Static fallback TP minimum for SCALP lowered
  - File: style-execution-envelopes.ts

  ### 4. SCALP Minimum R:R Reduced (1.5 to 1.3)
  - SCALP-specific R:R minimum lowered for feasibility in low-vol sessions
  - Files: trading-constants.ts, alpha-identity.ts

  ## Architectural Principle
  Alpha is the sole trade decision-maker within arena walls.
  Advisory systems provide monitoring intelligence but cannot override Alpha's decisions.

  ## Security
  - No table changes, no RLS changes
  - Governance tracking only
*/

INSERT INTO ccip_change_requests (
  change_title,
  change_type,
  priority,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  deployed_at,
  deployment_method,
  rollback_plan,
  related_migration,
  modified_files,
  database_changes,
  breaking_changes
) VALUES (
  'Alpha Sole Trade Authority - Advisory-Only Penalties',
  'refactor',
  'critical',
  'Confidence engine penalties (adversarial, regime, session, EQS, narrative, pattern) are now advisory-only. They are calculated and logged for dashboards but do NOT reduce Alpha execution confidence. Also: ATR noise floor 1.25x->1.15x, SCALP TP min 15->12 pips, SCALP R:R 1.5->1.3.',
  'GBPUSD SELL at 60% was blocked when adversarial whipsaw penalty reduced confidence to 55%. This violates the architectural principle that Alpha is sole trade authority within arena walls. Advisory systems should inform, not veto.',
  'confidence-calculation-engine.ts: final_confidence now uses Alpha raw + rewards only, penalties logged as advisory_adjusted_confidence. alpha-omega-orchestrator.ts: updated logging. risk-aware-stop-calculator.ts: ATR noise floor 1.25->1.15. style-execution-envelopes.ts: SCALP TP min 15->12. trading-constants.ts: SCALP R:R 1.5->1.3. alpha-identity.ts: system prompt updated.',
  'low',
  'deployed',
  'approved',
  now(),
  'code_change_with_migration',
  'Revert confidence engine to apply penalties to final_confidence. Revert ATR to 1.25x. Revert SCALP TP to 15. Revert SCALP R:R to 1.5.',
  '20260217_ccip_alpha_sole_authority_advisory_penalties_governance',
  ARRAY['confidence-calculation-engine.ts','alpha-omega-orchestrator.ts','risk-aware-stop-calculator.ts','style-execution-envelopes.ts','trading-constants.ts','alpha-identity.ts','omega9-constraint-provider.ts'],
  false,
  false
);
