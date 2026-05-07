/*
  # CCIP-2026-0507A: Alpha Hunter SL Contract — Noise-Aware Invalidation

  1. Purpose
    - Codify SL placement discipline into Alpha's reasoning via prompt-only change.
    - Parallel cadence to CCIP-2026-0506F TP2-Win Design contract.
    - Force Alpha to defend every SL on live tape data (M5 wicks, spread, micro-regime,
      sweep geometry) with zero historical memory to prevent bias contamination.

  2. What changed
    - src/config/alpha-identity.ts:
      * Added HUNTER'S SL CONTRACT (MICRO_INTRADAY) block with 3 live-data self-checks
        (noise envelope, sweep buffer, instrument breathing room)
      * Added 4 new answer_sheet fields:
        - sl_feasibility_noise_envelope (PASS/FAIL)
        - sl_feasibility_sweep_buffer (PASS/FAIL/NOT_APPLICABLE)
        - sl_feasibility_breathing_room (PASS/FAIL)
        - sl_placement_rationale (one-sentence defense citing live evidence)

  3. Governance notes
    - No infrastructure gates, no executor changes, no hard blocks added.
    - Per Pipnosis Core Mandate: improve Alpha's brain, not add constraints.
    - No memory of prior trades/scans — all SL reasoning from live briefing only.
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
      'contract_name', 'HUNTER_SL_CONTRACT_MICRO_INTRADAY',
      'version', 'pre-0507A',
      'rule', 'SL discipline implicit — no mandatory noise/sweep/breathing-room self-check'
    ),
    jsonb_build_object(
      'contract_name', 'HUNTER_SL_CONTRACT_MICRO_INTRADAY',
      'version', '0507A',
      'rule', 'Noise-aware invalidation — SL must live BEYOND where liquidity is taken, defended on live tape',
      'feasibility_checks', jsonb_build_array(
        'sl_feasibility_noise_envelope',
        'sl_feasibility_sweep_buffer',
        'sl_feasibility_breathing_room'
      ),
      'rationale_field', 'sl_placement_rationale',
      'no_historical_memory', true,
      'live_data_sources', jsonb_build_array(
        'current_m5_wick_structure',
        'current_spread',
        'current_micro_regime',
        'current_sweep_geometry'
      )
    ),
    'CCIP-2026-0507A: Upgrade Alpha HUNTER SL CONTRACT to noise-aware invalidation with three mandatory live-data self-checks (noise envelope, sweep buffer, breathing room). No historical memory to prevent bias contamination. Prompt-side only; no infrastructure gates added.',
    v_owner_id,
    jsonb_build_object(
      'ccip_tag', 'CCIP-2026-0507A',
      'files_changed', jsonb_build_array('src/config/alpha-identity.ts'),
      'new_answer_sheet_fields', jsonb_build_array(
        'sl_feasibility_noise_envelope',
        'sl_feasibility_sweep_buffer',
        'sl_feasibility_breathing_room',
        'sl_placement_rationale'
      ),
      'triggered_by', 'SPX500 SELL trade 1 stopped on 1.7pt noise; re-scan trade 2 same direction won TP2',
      'parallel_to', 'CCIP-2026-0506F'
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
      'ccip_tag', 'CCIP-2026-0507A',
      'description', 'Alpha SL Noise-Aware Invalidation Contract',
      'prompt_file', 'src/config/alpha-identity.ts',
      'section', 'HUNTER_SL_CONTRACT_MICRO_INTRADAY',
      'new_answer_sheet_fields', jsonb_build_array(
        'sl_feasibility_noise_envelope',
        'sl_feasibility_sweep_buffer',
        'sl_feasibility_breathing_room',
        'sl_placement_rationale'
      )
    ),
    v_governance_id
  );
END $$;