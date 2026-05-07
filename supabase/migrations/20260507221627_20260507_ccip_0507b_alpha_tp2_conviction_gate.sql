/*
  # CCIP-2026-0507B: Alpha TP2 Conviction Gate + Auto-Breakeven Safety Net

  1. Purpose
    - Collapse TP2 discretion into a binary conviction gate. Writing a TP2 is
      itself a declaration of full conviction; a fragile "tightened TP2" is no
      longer permitted. If any feasibility check fails or no driver exists,
      tp2 is set null and the trade is designed as TP1_ONLY_SCALP.
    - Make the post-TP1 management rule mechanical: whenever TP2 is present,
      tp1_action = move_sl_to_breakeven is automatic. hold_sl is forbidden on
      two-target plans. The original SL can no longer convert a realized TP1
      gain into a net loss.
    - Triggered by NAS100 SELL MICRO_INTRADAY 2026-05-07: TP1 hit +$486, runner
      reversed and took out original SL for -$60.75 on the remainder (net
      -$121.50). Correct directional read converted into a loss by an
      unprotected runner.

  2. What changed — src/config/alpha-identity.ts
    - HUNTER TP CONTRACT rewritten as CCIP-2026-0507B TP2 CONVICTION GATE +
      AUTO-BREAKEVEN BACKUP. Binary: TP2 present (all 3 feasibility PASS AND
      named driver) or TP2 absent (TP1_ONLY_SCALP).
    - STEP 7 added: auto-breakeven safety net is mandatory when TP2 present.
    - Self-contradiction checks updated to enforce the gate (FAIL feasibility
      with a written tp2 is now a direct violation, not a trigger to tighten).
    - Two new answer_sheet fields:
        * tp2_conviction_declaration (mandatory when TP2 present)
        * tp2_absent_reason (mandatory when tp2 is null)
    - trade_management schema note: tp1_action = move_sl_to_breakeven is
      mandatory whenever a tp2 price is present. hold_sl only legal on
      TP1_ONLY_SCALP. move_sl_to_level only permitted to move SL tighter than
      breakeven into profit.
    - Existing CCIP-2026-0506F feasibility fields retagged with CONVICTION
      GATE semantics (FAIL = TP2 forbidden, not TP2 tightened).

  3. Governance notes
    - Brain-only change. No executor gates. No TypeScript changes beyond the
      prompt file.
    - No historical memory introduced — all conviction reasoning still comes
      from live briefing evidence.
    - Parallel cadence to CCIP-2026-0506F (TP2-Win Design) and
      CCIP-2026-0507A (SL Noise-Aware Invalidation).
*/

DO $$
DECLARE
  v_owner_id uuid;
  v_governance_id uuid;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

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
    'ccip_migration_applied',
    jsonb_build_object(
      'contract_name', 'HUNTER_TP_CONTRACT_MICRO_INTRADAY',
      'version', '0506F',
      'rule', 'TP2-Win Design — TP2 is the idea; if feasibility FAIL, TIGHTEN TP2 inward to nearest structural level. tp1_action discretionary (move_sl_to_breakeven | move_sl_to_level | hold_sl).',
      'known_failure_mode', 'Fragile tightened TP2 paired with hold_sl tp1_action allowed realized TP1 gain to convert into net loss when runner reversed through entry.'
    ),
    jsonb_build_object(
      'contract_name', 'HUNTER_TP_CONTRACT_MICRO_INTRADAY',
      'version', '0507B',
      'rule', 'TP2 Conviction Gate — binary. Writing a TP2 is a conviction declaration. If any feasibility check FAIL or no driver, TP2 is FORBIDDEN (tp2 = null, TP1_ONLY_SCALP). When TP2 is present, tp1_action = move_sl_to_breakeven is MANDATORY (auto safety net).',
      'conviction_gate_checks', jsonb_build_array(
        'tp2_feasibility_structural_runway',
        'tp2_feasibility_momentum_budget',
        'tp2_feasibility_time_to_target',
        'tp1_to_tp2_driver'
      ),
      'new_answer_sheet_fields', jsonb_build_array(
        'tp2_conviction_declaration',
        'tp2_absent_reason'
      ),
      'tp1_action_when_tp2_present', 'move_sl_to_breakeven (mandatory, no discretion)',
      'tp1_action_when_tp1_only_scalp', 'move_sl_to_breakeven | hold_sl | move_sl_to_level (discretionary)',
      'hold_sl_forbidden_on_two_target_plans', true,
      'tighten_tp2_fallback_removed', true
    ),
    'CCIP-2026-0507B: Collapse TP2 discretion into a binary conviction gate and make post-TP1 breakeven the mechanical safety net whenever TP2 is present. Triggered by NAS100 SELL 2026-05-07 where correct directional read converted to net loss via unprotected runner after TP1. Brain-only change; no executor gates.',
    v_owner_id,
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0507B',
      'files_changed', jsonb_build_array('src/config/alpha-identity.ts'),
      'parallel_to', jsonb_build_array('CCIP-2026-0506F', 'CCIP-2026-0507A'),
      'triggered_by_trade', jsonb_build_object(
        'symbol', 'NAS100',
        'action', 'SELL',
        'style', 'MICRO_INTRADAY',
        'entry', 28573.70,
        'exit', 28587.20,
        'tp1_realized_usd', 486.00,
        'tp2_missed_usd', -60.75,
        'net_usd', -121.50,
        'peak_profit_usd', 632.70,
        'root_cause', 'tp1_action not move_sl_to_breakeven; original SL survived against runner after TP1 hit'
      ),
      'no_historical_memory_introduced', true
    )
  )
  RETURNING id INTO v_governance_id;

  INSERT INTO ccip_change_tracking (
    user_id,
    operation_type,
    table_name,
    record_id,
    change_details,
    governance_log_id
  )
  VALUES (
    v_owner_id,
    'ccip_migration_applied',
    'alpha_prompt_config',
    v_governance_id,
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0507B',
      'description', 'Alpha TP2 Conviction Gate + Auto-Breakeven Safety Net',
      'prompt_file', 'src/config/alpha-identity.ts',
      'section', 'HUNTER_TP_CONTRACT_MICRO_INTRADAY',
      'new_answer_sheet_fields', jsonb_build_array(
        'tp2_conviction_declaration',
        'tp2_absent_reason'
      ),
      'tp1_action_policy', 'move_sl_to_breakeven mandatory when TP2 present; hold_sl forbidden on two-target plans',
      'removes', 'tighten-TP2-inward fallback path from CCIP-2026-0506F'
    ),
    v_governance_id
  );
END $$;