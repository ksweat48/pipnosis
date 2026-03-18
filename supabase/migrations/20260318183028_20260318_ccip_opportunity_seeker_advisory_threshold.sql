/*
  # CCIP-2026-0318A-ADVISORY: Opportunity-Seeker Mandate — Advisory Threshold System

  ## Summary
  Records the governance change from CCIP-2026-0317A "capital preservation" philosophy
  to CCIP-2026-0318A-ADVISORY "opportunity-seeker" mandate.

  ## Philosophy Change
  - BEFORE: Alpha's standard was "capital preservation through high-probability execution."
    The adaptive confidence floor was a hard gate. The || 70 fallback blocked ACCEPTABLE-band
    (50-69%) trades. Q5 was phrased as a soft veto. earlyExit threshold was 72.
  - AFTER: Alpha finds and executes the best available opportunity every scan cycle.
    ACCEPTABLE setups (50-69%) with structural basis and correct RR are valid professional
    trades. The adaptive floor is advisory-only. Q5 is a transparency disclosure.
    earlyExit threshold is 50 (aligned with MINIMUM_TRADE_CONFIDENCE).

  ## Code Changes Documented
  1. alpha-identity.ts — Identity, Q5, Q7, Asian session, London-NY, FLOOR_DEFAULT 60→50
  2. coordinator-alpha.ts — SCAN MANDATE and CONFIDENCE BANDS added to user prompt
  3. goal-session-live-engine.ts — || 70 fallbacks → ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE
  4. concurrent-execution-config.ts — earlyExit.minConfidenceThreshold 72→50
  5. alpha-omega-orchestrator.ts — minConfidence fallback → ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE
  6. alpha-adaptive-floor-service.ts — getAdvisoryContext() added as primary advisory method

  ## Security
  No RLS changes. All existing policies remain in force.
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
  'alpha_execution_policy',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'philosophy', 'capital_preservation',
    'min_confidence_fallback', 70,
    'early_exit_threshold', 72,
    'adaptive_floor_mode', 'hard_gate',
    'adaptive_floor_default', 60,
    'q5_mode', 'soft_veto',
    'ccip_version', 'CCIP-2026-0317A'
  ),
  jsonb_build_object(
    'philosophy', 'opportunity_seeker',
    'min_confidence_fallback', 50,
    'early_exit_threshold', 50,
    'adaptive_floor_mode', 'advisory_only',
    'adaptive_floor_default', 50,
    'q5_mode', 'transparency_disclosure',
    'ccip_version', 'CCIP-2026-0318A-ADVISORY'
  ),
  'CCIP-2026-0318A-ADVISORY: Reversed capital-preservation mandate. Alpha is an active opportunity-hunter. ACCEPTABLE setups (50-69%) are valid professional trades. Adaptive floor is advisory context, never a hard gate. Q5 is a transparency disclosure, not a veto. Early-exit and execution fallbacks aligned with MINIMUM_TRADE_CONFIDENCE (50).',
  jsonb_build_object(
    'files_changed', to_jsonb(ARRAY[
      'src/config/alpha-identity.ts',
      'src/brains/coordinator-alpha.ts',
      'src/services/goal-session-live-engine.ts',
      'src/config/concurrent-execution-config.ts',
      'src/services/alpha-omega-orchestrator.ts',
      'src/services/alpha-adaptive-floor-service.ts'
    ]),
    'governance_class', 'CCIP_PHILOSOPHY_CHANGE',
    'breaking_change', false,
    'data_safe', true
  )
);
