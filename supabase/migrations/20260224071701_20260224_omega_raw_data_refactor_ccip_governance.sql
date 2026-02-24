/*
  # CCIP Governance: Omega Raw Data Refactor — Architecture Change Log

  ## Title
  CCIP-2026-02-24: Omega Council Refactor — Raw Data to Alpha

  ## Summary
  Records the architectural change where Omega specialist brains (1-5)
  are removed from the execution pipeline. Alpha receives pure raw market
  data. Only Omega-8 (Orderflow) remains for genuine computation.

  ## Changes Tracked
  1. ccip_change_requests record (type=refactor) — full change specification
  2. governance_change_log records — using 'configuration_change' operation for alpha_coordinator
     and 'configuration_update' for alpha_prompt_config enrichment

  ## SSOT / CCIP Compliance
  - MarketBriefing remains SSOT for all data reaching Alpha
  - OmegaCouncilVotes type retained; only omega8/omega9 populated going forward
  - No duplicate data paths introduced
  - Change tracked in both governance tables per CCIP protocol
*/

-- 1. CCIP Change Request record
INSERT INTO ccip_change_requests (
  id,
  change_title,
  change_type,
  priority,
  requested_by,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  approved_at,
  rollback_plan,
  modified_files,
  database_changes,
  breaking_changes
)
VALUES (
  gen_random_uuid(),
  'CCIP-2026-02-24: Omega Council Refactor — Raw Data to Alpha',
  'refactor',
  'high',
  NULL,
  'Omega specialist brains 1-5 removed from execution pipeline. Alpha now receives pure raw market observations. Omega-8 orderflow retained for genuine computation. buildOmegaVerificationSummary() and detectOmegaThesisConflict() removed.',
  'Alpha is the reasoning AI. Pre-synthesized Omega bias labels (BULLISH, FAVORABLE, score:45) were anchoring Alpha to pre-conclusions. Raw data gives Alpha full information with no framing bias.',
  'Files: alpha-omega-orchestrator.ts, coordinator-alpha.ts, market-briefing-builder.ts, omega-vote.ts, omega-consensus-advisory.ts, style-qualification-gate.ts. OmegaCouncilVotes trend/scalper/confirmation/reversal/volatility always null going forward.',
  'Low. Omega 1-5 outputs were non-binding advisories. Alpha confidence threshold and Omega-9 geometry validation unchanged. Briefing enriched with ATR ratio, VWAP ATR distance, S/R ATR distances, wick ratio.',
  'approved',
  'approved',
  now(),
  'Restore Omega 1-5 calls in alpha-omega-orchestrator.ts. Restore buildOmegaVerificationSummary and detectOmegaThesisConflict in coordinator-alpha.ts.',
  ARRAY[
    'src/services/alpha-omega-orchestrator.ts',
    'src/brains/coordinator-alpha.ts',
    'src/services/market-briefing-builder.ts',
    'src/types/omega-vote.ts',
    'src/services/omega-consensus-advisory.ts',
    'src/services/style-qualification-gate.ts'
  ],
  false,
  false
)
ON CONFLICT DO NOTHING;

-- 2. Governance change log — pipeline reconfiguration
INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata,
  created_at
)
VALUES (
  gen_random_uuid(),
  'alpha_coordinator',
  'a4f3e2d1-0000-4000-8000-cccc20260224'::uuid,
  'configuration_change',
  jsonb_build_object(
    'omegas_in_pipeline', ARRAY['trend','scalper','confirmation','reversal','volatility','orderflow'],
    'vote_counting', true,
    'synthesized_labels', true,
    'methods', ARRAY['buildOmegaVerificationSummary','detectOmegaThesisConflict']
  ),
  jsonb_build_object(
    'omegas_in_pipeline', ARRAY['orderflow'],
    'vote_counting', false,
    'synthesized_labels', false,
    'methods', '[]',
    'raw_data_enrichments', ARRAY['atr_ratio','vwap_atr_distance','sr_atr_distances','wick_ratio']
  ),
  'CCIP-2026-02-24: Omega 1-5 synthesis layer removed. Alpha receives pure raw observations. Omega-8 retained for genuine orderflow computation.',
  jsonb_build_object('ccip_reference', 'CCIP-2026-02-24', 'ssot_compliance', true),
  now()
),
(
  gen_random_uuid(),
  'alpha_prompt_config',
  'b5e4f3d2-0000-4000-8000-cccc20260224'::uuid,
  'configuration_update',
  jsonb_build_object(
    'atr_ratio_in_briefing', false,
    'vwap_atr_distance_in_briefing', false,
    'sr_atr_distances_in_briefing', false,
    'wick_ratio_in_briefing', false
  ),
  jsonb_build_object(
    'atr_ratio_in_briefing', true,
    'vwap_atr_distance_in_briefing', true,
    'sr_atr_distances_in_briefing', true,
    'wick_ratio_in_briefing', true
  ),
  'CCIP-2026-02-24: Market briefing enriched with raw ATR ratio, VWAP ATR distance, S/R ATR distances, wick ratio so Alpha reasons about regime from numbers alone.',
  jsonb_build_object('ccip_reference', 'CCIP-2026-02-24', 'ssot_compliance', true),
  now()
)
ON CONFLICT DO NOTHING;
