/*
  # CCIP-2026-0327A: Remove Numerical Anchoring from Exhausted Move Advisories — All Styles

  ## Change Control Summary

  ### Authority
  CCIP-2026-0327A — Conviction-First Confidence Governance (Exhausted Move Advisory Phase)
  Authored: 2026-03-28
  Supersedes: Partial fix in CCIP-2026-0326B (which addressed confidence bands, Q8D, and intermarket penalties)

  ### Root Cause
  The ATR Legend Prompt in coordinator-alpha.ts contained a per-style EXHAUSTED move advisory
  that instructed Alpha to arithmetically deduct confidence points when a move is exhausted:

    SCALP:         "ADVISORY: reduce confidence 15-25pts. Assess structural justification..."
    MICRO_INTRADAY:"ADVISORY: reduce confidence 15-25pts. Reason about structural reversal/retest..."
    INTRADAY:      "ADVISORY: reduce confidence 15-25pts. Reason about reversal/retest/sweep..."

  This is identical in character to the Q8D penalty removed in CCIP-2026-0326B:
  a formula-style deduction applied from outside Alpha's own reasoning, violating the
  conviction-first principle. Alpha's confidence must represent genuine conviction derived
  from evidence — not a pre-applied arithmetic floor adjustment.

  User-initiated scope expansion: "please also reform all styles accordingly not just scalp."
  This confirms all three style branches require the same reform.

  ### Changes Made (coordinator-alpha.ts line ~3328)
  All three style branches in the EXHAUSTED move advisory were reformed:

  1. SCALP: Removed "reduce confidence 15-25pts". Replaced with reasoning mandate:
     "Move is extended. Name whether this is a reversal, retest, or sweep setup. Exhausted moves
     can produce strong reversals — reason honestly about whether a genuine directional case exists.
     Your confidence reflects your actual conviction."

  2. INTRADAY: Removed "reduce confidence 15-25pts". Replaced with reasoning mandate:
     "Move is extended. Reason about reversal, retest, or sweep opportunity. Recalculate R:R from
     current price. Name what structural case exists or why it does not. Your confidence reflects
     your actual conviction."

  3. MICRO_INTRADAY: Removed "reduce confidence 15-25pts". Replaced with reasoning mandate:
     "Move is extended. Name whether a structural reversal, retest, or sweep setup exists on M15.
     Exhausted M15 moves can produce strong reversals — reason honestly about the structural case.
     Your confidence reflects your actual conviction."

  ### SSOT Compliance
  - coordinator-alpha.ts is SSOT for Alpha prompt text (atrLegendPrompt block)
  - No numerical thresholds modified in alpha-identity.ts, trading-constants.ts, or style-personalities.ts
  - This is a prompt governance change only — no schema DDL changes required

  ### Governance Chain
  CCIP-2026-0326A → CCIP-2026-0326B → CCIP-2026-0327A

  All three changes form a unified conviction-first governance series:
  - 0326A: Initial confidence band and Q8D formula removal (partial)
  - 0326B: Completed band removal, Q8D formula, intermarket_correlation DIVERGENT penalty
  - 0327A: Exhausted move 15-25pt deduction removed across all three trade styles
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
    'ccip_version', 'CCIP-2026-0326B',
    'exhausted_advisory_scalp', 'ADVISORY: reduce confidence 15-25pts. Assess structural justification (reversal/retest/sweep). Exhausted moves can produce strong reversals. Only NO_TRADE if no directional case exists',
    'exhausted_advisory_micro_intraday', 'ADVISORY: reduce confidence 15-25pts. Reason about structural reversal/retest/sweep setup. Exhausted M15 moves can produce strong reversals. Only NO_TRADE if no directional structural case exists',
    'exhausted_advisory_intraday', 'ADVISORY: reduce confidence 15-25pts. Reason about reversal/retest/sweep. Recalculate R:R from current price. Only NO_TRADE if recalculated TP1 R:R < 1.0:1'
  ),
  jsonb_build_object(
    'ccip_version', 'CCIP-2026-0327A',
    'exhausted_advisory_scalp', 'ADVISORY: Move is extended. Name whether this is a reversal, retest, or sweep setup. Exhausted moves can produce strong reversals — reason honestly about whether a genuine directional case exists. Your confidence reflects your actual conviction.',
    'exhausted_advisory_micro_intraday', 'ADVISORY: Move is extended. Name whether a structural reversal, retest, or sweep setup exists on M15. Exhausted M15 moves can produce strong reversals — reason honestly about the structural case. Your confidence reflects your actual conviction.',
    'exhausted_advisory_intraday', 'ADVISORY: Move is extended. Reason about reversal, retest, or sweep opportunity. Recalculate R:R from current price. Name what structural case exists or why it does not. Your confidence reflects your actual conviction.',
    'source_file', 'src/brains/coordinator-alpha.ts',
    'line_reference', 'atrLegendPrompt EXHAUSTED branch ~line 3328'
  ),
  'CCIP-2026-0327A: Remove last surviving numerical anchoring mechanism from Alpha ATR legend prompt. The exhausted move advisory for all three styles (SCALP, MICRO_INTRADAY, INTRADAY) contained an explicit "reduce confidence 15-25pts" formula deduction — identical in character to the Q8D penalty removed in CCIP-2026-0326B. All three style branches reformed to conviction-first reasoning mandates. Alpha confidence must be earned from market evidence, not subtracted by formula. Scope: user-confirmed all-style reform.',
  jsonb_build_object(
    'change_class', 'prompt_governance',
    'breaking_change', false,
    'requires_deploy', true,
    'styles_affected', to_jsonb(ARRAY['SCALP', 'MICRO_INTRADAY', 'INTRADAY']::text[]),
    'governance_chain', to_jsonb(ARRAY['CCIP-2026-0326A', 'CCIP-2026-0326B', 'CCIP-2026-0327A']::text[]),
    'files_changed', to_jsonb(ARRAY['src/brains/coordinator-alpha.ts']::text[])
  )
);
