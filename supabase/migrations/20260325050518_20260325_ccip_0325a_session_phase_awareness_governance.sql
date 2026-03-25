/*
  # CCIP-2026-0325A: Session-Phase Awareness Governance

  ## Summary
  Governance audit record for CCIP-2026-0325A — Session-Phase Awareness Governance.

  ## Problem Addressed
  Alpha had session identity language (what each session is) but no mandatory analytical
  questions requiring him to surface session-specific evidence. Scans at 02:00 UTC (Asian
  accumulation) and 08:30 UTC (London expansion) produced structurally similar answer_sheets
  — statistically impossible if genuinely analyzing different market phases.

  ## Changes Applied
  1. alpha-identity.ts: Mandatory 3-step session header per session before directional analysis.
  2. alpha-identity.ts: Q12 MARKET PHASE — mandatory control TF phase classification
     (ACCUMULATION/EXPANSION/DISTRIBUTION/RETRACEMENT/REVERSAL) with evidence-first governance.
  3. alpha-identity.ts: New answer_sheet fields: Q12_market_phase, session_high, session_low,
     prior_session_high, prior_session_low, session_sweep_status.
  4. coordinator-alpha.ts: TypeScript interface, extraction, coherence obligations updated.
  5. coordinator-alpha.ts: Q12_MARKET_PHASE_OMITTED advisory violation audit added.

  ## Governance Compliance
  - SSOT: All prompt changes in alpha-identity.ts only
  - No new hard execution gates — enforcement is prompt-level with audit trail
  - Violation logging uses existing logViolation() infrastructure
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
  'alpha_prompt_config',
  gen_random_uuid(),
  'configuration_update',
  jsonb_build_object(
    'version', 'CCIP-2026-0324A',
    'q_count', 11,
    'session_phase_awareness', false
  ),
  jsonb_build_object(
    'version', 'CCIP-2026-0325A',
    'q_count', 12,
    'session_phase_awareness', true,
    'new_answer_sheet_fields', jsonb_build_array(
      'Q12_market_phase',
      'session_high',
      'session_low',
      'prior_session_high',
      'prior_session_low',
      'session_sweep_status'
    ),
    'new_coherence_obligations', 5,
    'new_advisory_violations', 1
  ),
  'CCIP-2026-0325A: Session-Phase Awareness Governance. Alpha now required to complete mandatory 3-step session header before directional analysis, classify market phase via Q12 with named candle evidence, and resolve 5 new session-phase contradictions in thesis_coherence_statement. No hard gates added — prompt-level enforcement with audit trail.',
  NULL,
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-0325A',
    'files_changed', jsonb_build_array(
      'src/config/alpha-identity.ts',
      'src/brains/coordinator-alpha.ts'
    ),
    'enforcement_model', 'prompt_level_with_audit_trail',
    'hard_gates_added', 0,
    'deployed_at', now()
  )
);
