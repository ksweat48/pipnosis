/*
  # CCIP-2026-0508B — Mandatory Contradiction Reconciliation Ledger

  Forces every fired contradiction to produce a recorded ledger entry.
  Extends alpha_dual_audition_audit view with ledger completeness fields.
*/

WITH new_log AS (
  INSERT INTO governance_change_log (entity_type, entity_id, operation, reason, new_value, metadata)
  VALUES (
    'alpha_prompt_config',
    gen_random_uuid(),
    'ccip_migration_applied',
    'CCIP-2026-0508B Mandatory Contradiction Reconciliation Ledger',
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0508B',
      'alpha_core_version', 'v3.6',
      'previous_version', 'v3.5',
      'description', 'Every fired contradiction must produce a recorded ledger entry with code, tier, what_fired, resolution_path letter, concrete resolution_evidence, and post_resolution_verdict=PASS. Vague overrides prohibited.'
    ),
    jsonb_build_object(
      'new_answer_sheet_keys', jsonb_build_array('contradictions_fired','contradictions_scanned_count','contradictions_unresolved_count','reconciliation_ledger_complete'),
      'tier_1_gates', jsonb_build_array('T1','T1B','T1C','T1D','T1E','T1F'),
      'tier_2_contradictions', jsonb_build_array('1','2','3','4','5','6','7','8','9','10','11','11A','11B','11C','11D','11E','11F','11G')
    )
  )
  RETURNING id
)
INSERT INTO ccip_change_tracking (user_id, operation_type, table_name, record_id, change_details, governance_log_id)
SELECT
  (SELECT id FROM user_profiles WHERE is_owner = true LIMIT 1),
  'prompt_upgrade',
  'alpha_prompt_config',
  gen_random_uuid(),
  jsonb_build_object(
    'ccip_reference', 'CCIP-2026-0508B',
    'alpha_core_version', 'v3.6',
    'deployment_bundle', jsonb_build_array('CCIP-2026-0508A','CCIP-2026-0508B')
  ),
  new_log.id
FROM new_log;

INSERT INTO alpha_reasoning_postmortems (decision_id, user_id, symbol, style, action, summary)
SELECT
  ad.id,
  (SELECT id FROM user_profiles WHERE is_owner = true LIMIT 1),
  COALESCE(ad.symbol, 'SYSTEM'),
  COALESCE(ad.trade_style, 'MICRO_INTRADAY'),
  COALESCE(ad.action, 'SYSTEM'),
  'CCIP-2026-0508B SYSTEMIC REASONING UPGRADE. Root cause: self-contradiction acknowledgement without recorded resolution — Alpha identified contradictions in prose (HTF trend vs sweep map, pattern bias vs action, SL-on-level) and proceeded to execute_now via vague overrides. Corrective action: reconciliation ledger mandatory (contradictions_fired array, contradictions_scanned_count equals full catalogue size, contradictions_unresolved_count=0 for immediate, reconciliation_ledger_complete=true). Self-consistency checklist item 7 and REASONED-PAST PROHIBITED PATTERN block make silent reasoning-past a governance violation.'
FROM alpha_decisions ad
ORDER BY ad.created_at DESC
LIMIT 1;

DROP VIEW IF EXISTS alpha_dual_audition_audit;

CREATE VIEW alpha_dual_audition_audit
WITH (security_invoker = true) AS
SELECT
  ad.id AS decision_id,
  ad.user_id,
  ad.symbol,
  ad.trade_style,
  ad.action,
  ad.alpha_entry_mode AS entry_mode,
  ad.confidence_tier,
  ad.created_at,
  ad.answer_sheet -> 'hypothesis_buy' AS hypothesis_buy,
  ad.answer_sheet -> 'hypothesis_sell' AS hypothesis_sell,
  ad.answer_sheet ->> 'Q_SWEEP_MAP_DIRECTION' AS sweep_map_direction,
  ad.answer_sheet ->> 'winning_hypothesis' AS winning_hypothesis,
  ad.answer_sheet ->> 'win_reason' AS win_reason,
  ad.answer_sheet ->> 'losing_hypothesis_disqualifier' AS losing_hypothesis_disqualifier,
  (
    ad.answer_sheet ? 'hypothesis_buy'
    AND ad.answer_sheet ? 'hypothesis_sell'
    AND ad.answer_sheet ? 'winning_hypothesis'
  ) AS audition_complete,
  ad.answer_sheet -> 'contradictions_fired' AS contradictions_fired,
  COALESCE((ad.answer_sheet ->> 'contradictions_scanned_count')::int, 0) AS contradictions_scanned_count,
  COALESCE((ad.answer_sheet ->> 'contradictions_unresolved_count')::int, 0) AS contradictions_unresolved_count,
  COALESCE((ad.answer_sheet ->> 'reconciliation_ledger_complete')::boolean, false) AS reconciliation_ledger_complete,
  (
    ad.answer_sheet ? 'contradictions_fired'
    AND ad.answer_sheet ? 'contradictions_scanned_count'
    AND ad.answer_sheet ? 'reconciliation_ledger_complete'
    AND COALESCE((ad.answer_sheet ->> 'reconciliation_ledger_complete')::boolean, false) = true
    AND COALESCE((ad.answer_sheet ->> 'contradictions_unresolved_count')::int, 1) = 0
  ) AS reconciliation_complete
FROM alpha_decisions ad;
