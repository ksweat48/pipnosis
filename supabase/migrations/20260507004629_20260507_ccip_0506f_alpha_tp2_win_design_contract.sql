/*
  # CCIP-2026-0506F: Alpha TP2-Win Design Contract

  1. Purpose
    - Governance record for the upgrade of Alpha's HUNTER'S TP CONTRACT in
      src/config/alpha-identity.ts from "TP2 first, TP1 inside" (structural
      scan order) to a binding TP2-WIN DESIGN CONTRACT with a mandatory
      feasibility self-check.

  2. What Changed in Alpha's Prompt
    - Every trade is now designed to reach TP2 (TP2 = "the idea"); TP1 is
      the near-guaranteed checkpoint in between.
    - Before anchoring TP2, Alpha must answer three feasibility questions:
      structural runway, momentum budget, time-to-target.
    - If any check fails, Alpha tightens TP2 inward to the nearest honest
      structural level — never a dream R:R.
    - If no honest TP2 exists or no continuation driver can be named, Alpha
      degrades the design to a TP1-only scalp. Alpha never outputs NO_TRADE
      on a feasibility concern alone.
    - Alpha must name one specific TP1→TP2 continuation driver backed by
      sensor evidence already in the briefing.
    - Four new mandatory answer_sheet fields capture the reasoning:
        tp2_feasibility_structural_runway
        tp2_feasibility_momentum_budget
        tp2_feasibility_time_to_target
        tp1_to_tp2_driver

  3. Storage
    - The four new fields live inside the existing alpha_decisions.answer_sheet
      jsonb column. No DDL required.

  4. Notes
    - Brain-only change. No new TypeScript gates, confidence floors, or
      executor-level blocks. Complies with the Pipnosis Core Mandate
      ("Improve Alpha's Brain, Not His Constraints").
    - Layer 2 (post-trade learning hook that feeds Alpha its own TP2
      calibration from these four fields) is deferred to CCIP-2026-0506G.
*/

DO $$
DECLARE
  v_governance_id uuid;
  v_owner_id uuid;
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
      'version', 'pre-0506F',
      'rule', 'TP2 first, TP1 inside (structural scan order only)'
    ),
    jsonb_build_object(
      'contract_name', 'HUNTER_TP_CONTRACT_MICRO_INTRADAY',
      'version', '0506F',
      'rule', 'TP2-WIN DESIGN — TP2 is the idea of the trade; TP1 is the checkpoint',
      'feasibility_checks', jsonb_build_array(
        'tp2_feasibility_structural_runway',
        'tp2_feasibility_momentum_budget',
        'tp2_feasibility_time_to_target'
      ),
      'continuation_driver_field', 'tp1_to_tp2_driver',
      'tighten_tp2_when_infeasible', true,
      'no_trade_on_feasibility_failure', false,
      'degrade_to_tp1_only_scalp_when_no_driver', true
    ),
    'CCIP-2026-0506F: Upgrade Alpha HUNTER TP CONTRACT to TP2-WIN DESIGN with mandatory feasibility self-check and graceful TP1-only scalp degradation when TP2 not honestly reachable. Prompt-side only; no infrastructure gates added.',
    v_owner_id,
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0506F',
      'files_changed', jsonb_build_array('src/config/alpha-identity.ts'),
      'new_answer_sheet_fields', jsonb_build_array(
        'tp2_feasibility_structural_runway',
        'tp2_feasibility_momentum_budget',
        'tp2_feasibility_time_to_target',
        'tp1_to_tp2_driver'
      ),
      'layer_2_learning_hook_deferred_to', 'CCIP-2026-0506G'
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
      'ccip_tag', 'CCIP-2026-0506F',
      'description', 'Alpha TP2-Win Design Contract',
      'prompt_file', 'src/config/alpha-identity.ts',
      'section', 'HUNTER_TP_CONTRACT_MICRO_INTRADAY',
      'new_answer_sheet_fields', jsonb_build_array(
        'tp2_feasibility_structural_runway',
        'tp2_feasibility_momentum_budget',
        'tp2_feasibility_time_to_target',
        'tp1_to_tp2_driver'
      )
    ),
    v_governance_id
  );
END $$;