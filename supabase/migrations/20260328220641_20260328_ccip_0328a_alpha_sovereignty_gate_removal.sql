/*
  # CCIP-2026-0328A: Alpha Sovereignty Gate Removal — Governance Audit Record

  ## Summary
  Records the governance decision to remove five non-physics execution gates that were
  overriding Alpha's trading judgment, and the fix to Alpha's self-calibration data feed.

  ## Gates Removed (code-level)

  1. Entry Overextension Hard Block — alpha-trade-executor.ts
     Advisory log only now. Alpha prices his entry into his reasoning.

  2. Session-level min_confidence gate — alpha-trade-executor.ts
     Only the 50% structural floor remains. Session config cannot impose higher gates.

  3. wait_pullback zone direction auto-downgrade — coordinator-alpha.ts
     Alpha's entry_mode and wait_condition pass downstream unchanged.

  4. Entry monitor gate NO_TRADE override — coordinator-alpha.ts
     Alpha reads monitor status in briefing and decides. Code does not veto.

  5. Omega8+9 dual-missing FATAL block — core-validation-gate.ts
     Downgraded to WARNING (passed:true). Sensors are advisors, not veto authorities.

  ## Improvements
  6. getAdvisoryContext() enriched — full per-bucket calibration data to Alpha
  7. confidence_cal label corrected in buildIntelligenceContext

  ## Tables Affected
  No schema changes — governance audit record only.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'alpha_sovereignty_policy',
  gen_random_uuid(),
  'ccip_policy_removal',
  '{"gates_active": ["ENTRY_OVEREXTENSION_BLOCK", "SESSION_MIN_CONFIDENCE_GATE", "WAIT_PULLBACK_ZONE_DOWNGRADE", "MONITOR_OFF_NO_TRADE_OVERRIDE", "OMEGA_DUAL_MISSING_FATAL"]}'::jsonb,
  '{"gates_active": [], "advisory_only": ["ENTRY_OVEREXTENSION_LOG", "OMEGA_DUAL_MISSING_WARNING"], "retained": ["CONFIDENCE_FLOOR_50_PHYSICS", "MAX_CONCURRENT_TRADES_USER_PREF"], "improvements": ["CALIBRATION_FEED_ENRICHED", "CALIBRATION_LABEL_FIXED"]}'::jsonb,
  'CCIP-2026-0328A: Removed trading judgment overrides per Alpha sovereignty principle. Only mathematical/data-integrity blocks retained per alpha-identity.ts LEGITIMATE_BLOCK_CONDITIONS.',
  '{"ccip_ref": "CCIP-2026-0328A", "principle": "Alpha sovereignty", "ssot_ref": "alpha-identity.ts LEGITIMATE_BLOCK_CONDITIONS", "files_changed": ["alpha-trade-executor.ts", "coordinator-alpha.ts", "core-validation-gate.ts", "alpha-adaptive-floor-service.ts"]}'::jsonb
);
