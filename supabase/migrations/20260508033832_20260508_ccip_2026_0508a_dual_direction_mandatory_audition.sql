/*
  # CCIP-2026-0508A — Dual-Direction Mandatory Audition (Prompt-Only)

  Symmetric parallel BUY/SELL hypothesis construction with Tier-1 contradiction
  gates + Q_SWEEP_MAP_DIRECTION arbiter. Eliminates 2.98:1 SELL:BUY skew.

  Governance: prompt-only per CLAUDE.md. Alpha sovereignty preserved.
*/

INSERT INTO governance_change_log (
  entity_type, entity_id, operation, new_value, reason, metadata
) VALUES (
  'alpha_prompt_config',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object('version', 'Alpha Core v3.5', 'dual_audition', true),
  'CCIP-2026-0508A: Symmetric dual-direction audition eliminates directional anchoring.',
  jsonb_build_object(
    'ccip_reference', 'CCIP-2026-0508A',
    'function_name', 'getAlphaSystemPromptForStyle',
    'file_path', 'src/config/alpha-identity.ts',
    'evidence', jsonb_build_object(
      'buy_pnl_60d', -4084, 'sell_pnl_60d', -228,
      'buy_trades', 52, 'sell_trades', 122, 'skew_ratio', 2.98
    ),
    'tier1_gates', jsonb_build_array('T1','T1B','T1C','T1D','T1E','T1F'),
    'new_answer_sheet_keys', jsonb_build_array(
      'hypothesis_buy','hypothesis_sell','Q_SWEEP_MAP_DIRECTION',
      'winning_hypothesis','win_reason','losing_hypothesis_disqualifier'
    )
  )
);

INSERT INTO ccip_change_tracking (
  user_id, operation_type, table_name, record_id, change_details
) VALUES (
  '91905a02-cf9e-4537-9920-98a4b790830a',
  'PROMPT_UPGRADE',
  'alpha_identity_config',
  gen_random_uuid(),
  jsonb_build_object(
    'ccip_reference', 'CCIP-2026-0508A',
    'change_name', 'dual_direction_mandatory_audition',
    'version_before', 'Alpha Core v3.4',
    'version_after', 'Alpha Core v3.5',
    'target_decision', '967e2691'
  )
);

INSERT INTO alpha_reasoning_postmortems (
  symbol, style, action, outcome, pnl_pct, summary
) VALUES (
  'US30', 'MICRO_INTRADAY', 'SELL', 'LOSS', NULL,
  'CCIP-2026-0508A postmortem. Decision 967e2691 (May 7 US30 SELL @ 49634, -$387). ' ||
  'FAILURE PATTERN: Directional anchoring on HTF trend + Q8D weekly narrative. ' ||
  'ROOT CAUSE: Linear PHASE -> LOCATION -> STRUCTURE flow committed to direction before liquidity-map audit. ' ||
  'UNDER NEW REASONING: SELL fails T1B (sweep-reclaim mismatch) and T1C (magnet delivered). BUY wins. ' ||
  'CORRECTIVE ACTION: Symmetric parallel dual-direction audition + Tier-1 gates. ' ||
  'GOVERNANCE: Prompt-only. No code gates added.'
);

CREATE OR REPLACE VIEW alpha_dual_audition_audit
WITH (security_invoker = true) AS
SELECT
  id AS decision_id,
  created_at,
  symbol,
  trade_style,
  action,
  confidence_tier,
  answer_sheet -> 'hypothesis_buy' AS hypothesis_buy,
  answer_sheet -> 'hypothesis_sell' AS hypothesis_sell,
  answer_sheet ->> 'Q_SWEEP_MAP_DIRECTION' AS sweep_map_direction,
  answer_sheet ->> 'winning_hypothesis' AS winning_hypothesis,
  answer_sheet ->> 'win_reason' AS win_reason,
  answer_sheet ->> 'losing_hypothesis_disqualifier' AS losing_hypothesis_disqualifier,
  (
    answer_sheet ? 'hypothesis_buy'
    AND answer_sheet ? 'hypothesis_sell'
    AND answer_sheet ? 'Q_SWEEP_MAP_DIRECTION'
    AND answer_sheet ? 'winning_hypothesis'
  ) AS audition_complete
FROM alpha_decisions
WHERE answer_sheet IS NOT NULL
ORDER BY created_at DESC;

COMMENT ON VIEW alpha_dual_audition_audit IS
  'CCIP-2026-0508A verification view. Confirms every scan populates both BUY and SELL hypotheses before picking a winner.';
