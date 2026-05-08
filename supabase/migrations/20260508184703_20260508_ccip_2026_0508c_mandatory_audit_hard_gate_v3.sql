/*
  # CCIP-2026-0508C — Mandatory Audit Hard Gate (audit log)

  Records deployment of the hard output-schema gate in coordinator-alpha.ts
  that forces NO_TRADE when Alpha's answer_sheet is missing any of the ten
  mandatory fields from CCIP-2026-0508A + CCIP-2026-0508B. Triggered by US30
  SELL decision 98dbf650-b59e-42bc-9399-efe22aed98e5 (-$427 on 2026-05-08).

  No schema changes. Audit-only inserts.
*/

DO $$
DECLARE
  v_governance_id uuid;
  v_ccip_entity_id uuid := gen_random_uuid();
  v_decision_user uuid;
  v_decision_symbol text;
BEGIN
  SELECT user_id, symbol
  INTO v_decision_user, v_decision_symbol
  FROM alpha_decisions
  WHERE id = '98dbf650-b59e-42bc-9399-efe22aed98e5';

  WITH gov AS (
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      new_value,
      reason,
      metadata
    )
    VALUES (
      'alpha_coordinator',
      v_ccip_entity_id,
      'ccip_migration_applied',
      jsonb_build_object(
        'ccip_reference', 'CCIP-2026-0508C',
        'gate_location', 'src/brains/coordinator-alpha.ts::coordinate()',
        'mandatory_fields', ARRAY[
          'hypothesis_buy','hypothesis_sell','Q_SWEEP_MAP_DIRECTION',
          'winning_hypothesis','win_reason','losing_hypothesis_disqualifier',
          'contradictions_fired','contradictions_scanned_count',
          'contradictions_unresolved_count','reconciliation_ledger_complete'
        ],
        'enforcement', 'force_no_trade_on_violation',
        'block_reason_tag', 'CCIP-2026-0508C_MANDATORY_AUDIT_INCOMPLETE'
      ),
      'Hard output-schema gate enforces the dual-audition and reconciliation-ledger contract from CCIP-2026-0508A and CCIP-2026-0508B. Triggered by US30 SELL decision 98dbf650-b59e-42bc-9399-efe22aed98e5 which bypassed both mandates and took -$427.',
      jsonb_build_object(
        'ccip_reference', 'CCIP-2026-0508C',
        'trigger_decision_id', '98dbf650-b59e-42bc-9399-efe22aed98e5',
        'trigger_symbol', 'US30',
        'trigger_pnl_usd', -427,
        'trigger_timestamp', '2026-05-08T17:12:00Z',
        'upstream_ccips', ARRAY['CCIP-2026-0508A', 'CCIP-2026-0508B']
      )
    )
    RETURNING id
  )
  SELECT id INTO v_governance_id FROM gov;

  IF v_decision_user IS NOT NULL THEN
    INSERT INTO ccip_change_tracking (
      user_id,
      operation_type,
      table_name,
      record_id,
      change_details,
      governance_log_id
    )
    VALUES (
      v_decision_user,
      'ccip_migration_applied',
      'alpha_coordinator',
      v_ccip_entity_id,
      jsonb_build_object(
        'ccip_reference', 'CCIP-2026-0508C',
        'change_title', 'Mandatory Audit Hard Gate',
        'change_description', 'Hard gate in coordinator-alpha.ts rewrites Alpha BUY/SELL decisions to NO_TRADE when the ten mandatory answer_sheet fields are missing or invalid.',
        'affected_files', ARRAY[
          'src/brains/coordinator-alpha.ts',
          'src/config/alpha-identity.ts'
        ],
        'status', 'deployed',
        'alpha_core_version', 'v3.7',
        'gate_type', 'output_schema_completeness',
        'trigger_decision_id', '98dbf650-b59e-42bc-9399-efe22aed98e5'
      ),
      v_governance_id
    );

    INSERT INTO alpha_reasoning_postmortems (
      decision_id,
      user_id,
      symbol,
      style,
      action,
      entry_mode,
      outcome,
      summary,
      top_citations
    )
    VALUES (
      '98dbf650-b59e-42bc-9399-efe22aed98e5',
      v_decision_user,
      COALESCE(v_decision_symbol, 'US30'),
      'MICRO_INTRADAY',
      'SELL',
      'execute_now',
      'LOSS',
      'CCIP-2026-0508C trigger event: Alpha executed US30 SELL without completing dual-direction audition or contradiction reconciliation ledger, despite CCIP-2026-0508A and CCIP-2026-0508B mandating both. Lost -$427. Resolution: CCIP-2026-0508C hard gate deployed in coordinator-alpha.ts — output schema is now structurally enforced.',
      jsonb_build_object(
        'ccip_reference', 'CCIP-2026-0508C',
        'violations', jsonb_build_array(
          'hypothesis_buy=null',
          'hypothesis_sell=null',
          'winning_hypothesis=null',
          'contradictions_fired=null',
          'reconciliation_ledger_complete=null',
          'pattern_direction_bias=bullish while SELL',
          'Q_SWEEP_RECLAIM_STATUS said wait_pullback while entry_mode=execute_now'
        ),
        'pnl_usd', -427,
        'occurred_at', '2026-05-08T17:12:00Z'
      )
    );
  END IF;
END $$;
