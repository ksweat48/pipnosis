/*
  # CCIP-2026-03-30 / SSOT-ALPHA-GOV-001
  # Remove Regime Volatility Multipliers from Omega-9 Constraint Provider

  ## 1. Problem
  The 0.7x (low) and 1.3x (high) regime multipliers in estimateVolatilityPerHour
  distorted the raw ATR signal flowing into Alpha's SESSION PHYSICS prompt:
    - 0.7x stacked with the Asian session multiplier, compressing feasibleTravelPips
      and nudging Alpha toward NO_TRADE on structurally valid setups.
    - 1.3x inflated feasibleTravelPips beyond raw ATR, misrepresenting risk capacity.

  ## 2. Change Applied (frontend — audit record only)
  File: omega9-constraint-provider.ts → estimateVolatilityPerHour()
    REMOVED: regimeMultiplier variable, 0.7x and 1.3x branches
    RETAINED: volatilityRegime param in contract (informational context for Alpha)

  ## 3. What Is NOT Changed
  - ATR_MULTIPLIER_BY_REGIME (wall-calibration-engine): TP ceiling width — valid, untouched
  - TP_FLOOR_RATIO_BY_REGIME (wall-calibration-engine): envelope floor compression — valid, untouched
  - ev-calculator.ts: regime used as DB filter only, no math — untouched

  ## 4. SSOT Compliance
  Session physics authority = raw ATR x sessionMultiplier only.

  ## 5. Post-Deploy Verification
  Logs should show: "Regime: low/medium/high (no multiplier)" not "Regime 0.7x/1.3x"
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id,
  metadata
)
VALUES (
  'alpha_execution_policy',
  gen_random_uuid(),
  'ccip_policy_removal',
  '{"regimeMultiplier":{"low":0.7,"medium":1.0,"high":1.3},"applied_to":"baseVolatility","file":"omega9-constraint-provider.ts","method":"estimateVolatilityPerHour"}'::jsonb,
  '{"regimeMultiplier":{"low":1.0,"medium":1.0,"high":1.0},"applied_to":"none","note":"regime label kept in contract for Alpha informational context only"}'::jsonb,
  'CCIP-2026-03-30 SSOT-ALPHA-GOV-001: Removed 0.7x/1.3x regime multipliers from volatility estimation. Both multipliers distorted ATR-based SESSION PHYSICS numbers Alpha reads in its prompt. Regime label retained in type contract for informational use. ATR_MULTIPLIER_BY_REGIME and TP_FLOOR_RATIO_BY_REGIME in wall-calibration-engine are separate valid concerns and remain unchanged.',
  NULL,
  '{"ccip_ref":"CCIP-2026-03-30","ssot_ref":"SSOT-ALPHA-GOV-001","affected_output":"feasibleTravelPips","alpha_prompt_section":"SESSION PHYSICS","governance_owner":"omega9-constraint-provider","wall_calibration_unchanged":true,"ev_calculator_unchanged":true}'::jsonb
);
