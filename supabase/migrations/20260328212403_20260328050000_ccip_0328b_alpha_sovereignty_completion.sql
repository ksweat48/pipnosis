/*
  # CCIP-2026-0328B: Alpha Sovereignty Completion

  ## Summary
  Formally records the Alpha Sovereignty governance change which removed all soft gates
  from the trade execution pipeline. Alpha LLM now has full, unimpeded authority over
  all trading decisions. Only hard data/geometry walls remain.

  ## Code Changes Recorded (applied outside migration)
  1. coordinator-alpha.ts: Q10 FORCED entry mode overwrite → advisory log only
  2. coordinator-alpha.ts: Q11 DEEP_ZONE entry mode overwrite → advisory log only
  3. coordinator-alpha.ts: Wait condition synthesis / entry mode downgrade → removed
  4. coordinator-alpha.ts: Breakout contradiction guard → removed
  5. confidence-calculation-engine.ts: Adaptive floor enforcement → advisory only
  6. confidence-calculation-engine.ts: Legacy penalty tombstone columns → removed from audit
  7. risk-preflight-gate.ts: RR_TOO_LOW BLOCKING → ADVISORY warning
  8. risk-preflight-gate.ts: RISK_PCT / EXPOSURE BLOCKING → ADVISORY warnings
  9. alpha-identity.ts: LEGITIMATE_BLOCK_CONDITIONS registry stamped with CCIP-2026-0328B

  ## Database Changes
  1. Drop legacy penalty tombstone columns from confidence_calculation_audit
  2. Extend governance_change_log valid_entity_type constraint to include 'alpha_sovereignty_policy'
  3. Insert governance audit record using 'ccip_policy_removal' operation

  ## Security
  No RLS changes required — governance tables already secured.
*/

-- Step 1: Drop legacy penalty tombstone columns from confidence_calculation_audit
DO $$
DECLARE
  col_names TEXT[] := ARRAY[
    'total_reward_bonus', 'eqs_penalty', 'narrative_penalty',
    'regime_oracle_penalty', 'regime_oracle_ceiling', 'adversarial_penalty',
    'session_advisory_penalty', 'penalty_isolation_check', 'pre_cap_confidence',
    'risk_mode_floor', 'post_risk_mode_cap'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY col_names LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'confidence_calculation_audit'
      AND column_name = col
    ) THEN
      EXECUTE format('ALTER TABLE confidence_calculation_audit DROP COLUMN %I', col);
    END IF;
  END LOOP;
END $$;

-- Step 2: Extend valid_entity_type constraint to include 'alpha_sovereignty_policy'
ALTER TABLE governance_change_log DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log ADD CONSTRAINT valid_entity_type CHECK (
  entity_type = ANY (ARRAY[
    'goal_sessions', 'goal_session_trades', 'entry_intents', 'user_profiles',
    'pending_user_modals', 'trade_processing_lock', 'database_migration',
    'system_configuration', 'club_token_balances', 'ai_trader_score',
    'timeout_governance_config', 'alpha_coordinator', 'realtime_intelligence_calculator',
    'alpha_wall_validation', 'alpha_prompt_config', 'llm_pipeline_governance',
    'alpha_type_contract', 'alpha_freshness_gate', 'alpha_regime_extractor',
    'thesis_immutability_guard', 'alpha_style_authority', 'alpha_execution_policy',
    'style_execution_envelope', 'alpha_sovereignty_policy'
  ])
);

-- Step 3: Insert governance audit record for CCIP-2026-0328B
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'alpha_sovereignty_policy',
  gen_random_uuid(),
  'ccip_policy_removal',
  jsonb_build_object(
    'soft_gates_active', true,
    'gates_removed', ARRAY[
      'Q10_FORCED_entry_mode_overwrite',
      'Q11_DEEP_ZONE_entry_mode_overwrite',
      'wait_condition_synthesis',
      'entry_mode_downgrade_on_missing_wait_condition',
      'breakout_contradiction_guard',
      'adaptive_floor_hard_enforcement',
      'RR_TOO_LOW_blocking_violation',
      'risk_pct_blocking_violation',
      'exposure_blocking_violation',
      'legacy_penalty_tombstone_columns'
    ]
  ),
  jsonb_build_object(
    'soft_gates_active', false,
    'alpha_has_full_authority', true,
    'only_hard_gates', ARRAY[
      'DATA_STALE', 'INVALID_STOP_LOSS', 'SPREAD_EXCEEDS_PROFIT',
      'BROKEN_FEED', 'MARKET_CLOSED', 'ZERO_DISTANCE_SL_TP',
      'MTF_DATA_MISSING', 'PRIMARY_TF_DATA_MISSING',
      'TOKEN_BUDGET_EXCEEDED', 'TIER_1_NEWS_ACTIVE'
    ]
  ),
  'CCIP-2026-0328B: Alpha Sovereignty Completion — all soft gates removed. Alpha LLM has full authority over all trading decisions. Only hard data/geometry walls remain.',
  jsonb_build_object(
    'ccip_version', 'CCIP-2026-0328B',
    'applied_at', now(),
    'files_modified', ARRAY[
      'src/brains/coordinator-alpha.ts',
      'src/services/confidence-calculation-engine.ts',
      'src/services/risk-preflight-gate.ts',
      'src/config/alpha-identity.ts'
    ]
  )
);
