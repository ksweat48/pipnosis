/*
  # CCIP Governance Audit — Alpha Reasoning Language Overhaul

  ## Title
  Alpha Identity and Reasoning Language Alignment — Trader-as-Decision-Maker Posture

  ## Summary
  Records the formal CCIP governance audit trail for the Alpha identity and system prompt
  language overhaul using the correct entity_type (alpha_coordinator) and operation
  (configuration_update) per existing constraints.

  ## Change Rationale
  Alpha's prompt language was framed around permission ("the only things that can stop you",
  "trust your edge") rather than objective-driven reasoning ("should I take this trade given
  what I am trying to achieve?"). This creates a reasoning posture where Alpha asks "can I
  trade?" instead of "should I trade, and does this serve the session objective?".

  ## Files Changed
  1. src/services/ai-identity.ts
  2. src/config/alpha-identity.ts
  3. src/config/style-personalities.ts

  ## SSOT Compliance
  - No confidence thresholds, EQS constants, or data contracts changed
  - counter_thesis_probability is an additive output field — fully backward-compatible
  - All confidence SSOT remains in alpha-identity.ts ALPHA_IDENTITY constant

  ## Governance Classification
  configuration_update — prompt language governance, no breaking schema changes
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
) VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'configuration_update',
  '{"posture": "permission_based", "mission": "Become the most profitable AI intraday trader in the world", "hard_block_header": "HARD BLOCKS — THE ONLY THINGS THAT CAN STOP YOU", "q6_scope": "identify failure mode only", "acceptable_band_directive": "proceed with awareness of weaknesses", "counter_thesis_probability": "absent"}',
  '{"posture": "objective_driven", "mission": "Generate positive expected value on every session by reasoning carefully about whether each trade serves the current objective", "hard_block_header": "STRUCTURAL FACTS — CONDITIONS WHERE NO VALID EDGE EXISTS", "q6_scope": "identify failure mode + materialisation probability + expected value evaluation", "objective_alignment_step_added": true, "acceptable_band_directive": "evaluate whether using a trade slot at 60-69% serves the session better than waiting", "counter_thesis_probability": "required output field 0-100 for every BUY/SELL", "files": ["src/services/ai-identity.ts", "src/config/alpha-identity.ts", "src/config/style-personalities.ts"]}',
  'CCIP-2026-0220: Alpha reasoning posture aligned from permission-based to objective-driven. Three source files updated. No thresholds or data contracts changed. Backward-compatible.',
  NULL,
  '{"ccip_id": "CCIP-2026-0220", "classification": "TIER_1_PROMPT_GOVERNANCE", "breaking_change": false, "ssot_impact": "none", "backward_compatible": true}'
);
