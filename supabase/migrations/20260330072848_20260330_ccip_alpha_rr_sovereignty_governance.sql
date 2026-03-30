/*
  # CCIP Governance Audit — Alpha R:R Sovereignty Restoration

  ## Title
  CCIP-2026-0330-RR: Remove 1:1 R:R Anchor from Alpha Q_EDGE Instruction

  ## Summary
  Alpha's Q_EDGE question previously contained "≥1:1 R:R" as the viability gate, which
  created a hidden numerical anchor. An LLM reads that as a target to engineer toward,
  causing Alpha to place SL and TP to satisfy 1:1 rather than placing both levels where
  market structure demands and reporting the honest resulting ratio.

  This migration records the governance change that restores Alpha's full R:R authority.

  ## Changes Applied (alpha-identity.ts)
  1. BUY/SELL Q_EDGE: removed the ≥1:1 anchor; Q_EDGE now confirms structural distance
     to target > structural distance to SL, then reports the market-derived ratio as output.
  2. NO_TRADE Q_EDGE: same correction — viability gate is purely geometric.
  3. professionalReasoningProcess step 3: replaced "minimum 1:1 R:R" with geometry-first
     formulation; step 4 clarifies R:R is a reported output, not an engineered target.

  ## Governance Compliance
  - SSOT: single authority for SL/TP is Alpha's structural judgment. Ratio = derived output.
  - CCIP: change tracked in governance_change_log under alpha_prompt_config + configuration_update.
  - Alpha sovereignty: SL behind structural invalidation; TP at nearest named structural
    target with clean air. R:R reported as the honest result of those two decisions.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'alpha_prompt_config',
  gen_random_uuid(),
  'configuration_update',
  jsonb_build_object(
    'Q_EDGE_buy_sell', 'YES — this range supports ≥1:1 R:R with a valid structural stop.',
    'Q_EDGE_no_trade', 'YES or NO — does that range support ≥1:1 R:R with a valid structural stop? If NO, why not.',
    'reasoning_step_3', 'Does that range support a minimum 1:1 R:R with a structurally anchored stop?'
  ),
  jsonb_build_object(
    'Q_EDGE_buy_sell', 'YES — the structural distance to my named target is greater than the structural distance to my SL level. The resulting R:R is [X]:1 — this is what the market structure produces, not a target I engineered toward.',
    'Q_EDGE_no_trade', 'YES or NO — is the structural distance from entry to the named target greater than the structural distance from entry to the SL level? YES means the market geometry produces a positive R:R — not that I engineered my levels to satisfy a ratio.',
    'reasoning_step_3', 'Is the structural distance to the named target greater than the structural distance to my SL level — where both levels are anchored to real market structure, not engineered to satisfy any ratio?'
  ),
  'CCIP-2026-0330-RR: 1:1 numerical anchor in Q_EDGE created hidden R:R targeting. Alpha SL and TP placement must be driven exclusively by market structure. The R:R ratio is a reported output of two independent structural decisions — not a gate value to engineer toward.',
  jsonb_build_object(
    'ccip_ref', 'CCIP-2026-0330-RR',
    'source_file', 'src/config/alpha-identity.ts',
    'fields_changed', jsonb_build_array('Q_EDGE (BUY/SELL schema)', 'Q_EDGE (NO_TRADE schema)', 'professionalReasoningProcess step 3'),
    'governance_principle', 'Alpha R:R sovereignty — ratio is output of structural judgment, never a target to engineer toward'
  )
);
