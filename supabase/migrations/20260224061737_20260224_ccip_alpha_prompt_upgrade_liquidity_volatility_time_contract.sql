/*
  # CCIP-2026-0224A — Alpha Prompt Upgrade: Liquidity Intelligence, Volatility Regime Filter, Scalp Time Contract

  ## Summary
  Records the CCIP-2026-0224A governance change in the governance_change_log table.
  No schema changes — the prompt lives in src/config/alpha-identity.ts (SSOT).

  ## Changes Documented

  ### 1. New SSOT Constants added to alpha-identity.ts
  - VOLATILITY_REGIME_THRESHOLDS: ATR-ratio bands (0.80 compression / 1.20 expansion / 2.00 spike)
  - SCALP_TIME_CONTRACT: Behavioral time limits (15-60min expected, 90min absolute hard wall)
  - STYLE_TIME_VIOLATION added to ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS

  ### 2. Three Alpha Prompt Additions (inside getAlphaSystemPromptForStyle)
  - VOLATILITY REGIME CHECK: Mandatory pre-entry ATR regime diagnostic, all styles
  - LIQUIDITY POSITIONING CHECK: Predatory reasoning — engineered vs organic, trapped participants,
    pool as magnet vs cap
  - SCALP TIME CONTRACT: Hard behavioral block — setup must resolve within 90min or NO_TRADE with
    reason STYLE_TIME_VIOLATION. Style downgrade to MICRO_INTRADAY is prohibited.

  ### 3. Pre-Submission Checklist expanded from 6 to 8 checks
  - Check 7: Volatility regime named and entry type confirmed appropriate
  - Check 8: Liquidity positioning diagnosed and factored into TP and confidence

  ## Security
  - No table schema changes
  - No RLS changes
  - Governance audit record only
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
    'checklist_items', 6,
    'block_conditions_count', 8,
    'volatility_regime_check', false,
    'liquidity_positioning_check', false,
    'scalp_time_contract_block', false
  ),
  jsonb_build_object(
    'checklist_items', 8,
    'block_conditions_count', 9,
    'block_condition_added', 'STYLE_TIME_VIOLATION',
    'volatility_regime_check', true,
    'liquidity_positioning_check', true,
    'scalp_time_contract_block', true,
    'volatility_thresholds', jsonb_build_object(
      'compression_max', 0.80,
      'expansion_min', 1.20,
      'spike_threshold', 2.00
    ),
    'scalp_time_limits_minutes', jsonb_build_object(
      'expected_min', 15,
      'expected_max', 60,
      'absolute_max', 90
    )
  ),
  'CCIP-2026-0224A: Three Alpha prompt precision upgrades — Liquidity Intelligence (engineered vs organic, trapped participant reasoning), Volatility Regime Filter (ATR ratio 0.80-1.20 normal band), Scalp Time Contract (behavioral hard block, 90min wall, STYLE_TIME_VIOLATION NO_TRADE, no style downgrade permitted)',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-0224A',
    'source_file', 'src/config/alpha-identity.ts',
    'function_modified', 'getAlphaSystemPromptForStyle',
    'ssot_constants_added', jsonb_build_array('VOLATILITY_REGIME_THRESHOLDS', 'SCALP_TIME_CONTRACT'),
    'block_condition_added', 'STYLE_TIME_VIOLATION',
    'approved_by', 'system'
  )
);
