/*
  # CCIP-2026-0326B: Remove Numerical Anchoring from Alpha Scan Prompt

  ## Change Control Summary

  ### Authority
  CCIP-2026-0326B — Conviction-First Confidence Governance (Prompt Anchoring Elimination Phase 2)
  Authored: 2026-03-27
  Supersedes: Partial fixes from CCIP-2026-0326A

  ### Root Cause
  Two numerical anchoring mechanisms survived the CCIP-2026-0326A fix:
  1. CONFIDENCE BANDS block exposed exact floor/ceiling boundaries (85-100, 70-84, 50-69, 0-49)
     enabling deliberate near-miss scoring at the 50/49 boundary
  2. Q8D delivery conflict check instructed "reduce confidence by at least 10 points"
     a formula-style deduction violating conviction-first scoring
  3. intermarket_correlation DIVERGENT used penalty-framing "reduce confidence accordingly"

  ### Changes Made (coordinator-alpha.ts)
  1. CONFIDENCE BANDS: Removed all numerical percentage ranges. Qualitative labels retained.
  2. Q8D lines 3566-3567: Removed 10-point penalty. Replaced with pure reasoning mandate.
  3. intermarket_correlation DIVERGENT: Removed penalty framing. Replaced with reasoning mandate.

  ### SSOT Compliance
  - coordinator-alpha.ts is SSOT for Alpha prompt text
  - alpha-identity.ts CONFIDENCE_BANDS object unchanged — min/max values retained for internal code use only
  - No DDL changes. Governance audit trail entry only.
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
  'alpha_prompt_config',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'ccip_version', 'CCIP-2026-0326A',
    'confidence_bands_prompt', 'EXCELLENT (85-100%) | SOLID (70-84%) | ACCEPTABLE (50-69%) | INSUFFICIENT (0-49%)',
    'q8d_bearish_on_buy', 'reduce confidence by at least 10 points if no structural reason named',
    'q8d_bullish_on_sell', 'reduce confidence by at least 10 points if no structural reason named',
    'intermarket_divergent', 'reduce confidence accordingly if no override reason named'
  ),
  jsonb_build_object(
    'ccip_version', 'CCIP-2026-0326B',
    'confidence_bands_prompt', 'Qualitative labels only — no numerical ranges in prompt text',
    'q8d_bearish_on_buy', 'Pure reasoning mandate — evaluate structural case, name it or reason honestly about conviction. No formula.',
    'q8d_bullish_on_sell', 'Pure reasoning mandate — evaluate structural case, name it or reason honestly about conviction. No formula.',
    'intermarket_divergent', 'Pure reasoning mandate — name override reason or reason honestly about conviction impact.',
    'source_file', 'src/brains/coordinator-alpha.ts'
  ),
  'CCIP-2026-0326B: Remove last surviving numerical anchoring mechanisms from Alpha scan prompt. Root cause: visible band floor boundary (50/49 gaming vector) and explicit 10-point Q8D formula deduction survived CCIP-2026-0326A. All advisory signals and conflict flags must inform reasoning, not produce arithmetic deductions from confidence. Principle: Alpha confidence is honest conviction scored directly from market evidence.',
  jsonb_build_object(
    'change_class', 'prompt_governance',
    'breaking_change', false,
    'requires_deploy', true,
    'governance_chain', to_jsonb(ARRAY['CCIP-2026-0326A', 'CCIP-2026-0326B']::text[]),
    'files_changed', to_jsonb(ARRAY['src/brains/coordinator-alpha.ts']::text[])
  )
);
