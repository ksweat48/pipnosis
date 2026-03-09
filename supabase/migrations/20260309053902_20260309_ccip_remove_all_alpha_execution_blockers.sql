/*
  # CCIP-2026-03-09: Remove All Alpha Execution Blockers

  ## Summary
  Governance audit record documenting the removal of all non-data-integrity
  blockers from Alpha's trade execution path.

  ## Changes Made (Frontend Code)

  ### 1. Growth Mode Block — REMOVED
  - GoalMode type: 4 values → 3 values (precision | execution | campaign)
  - Growth mode deleted entirely. Campaign has no upper cap.
  - GoalClassification.shouldBlockExecution field removed.
  - GoalClassification.alternativeApproach field removed.
  - All mode minConfidenceThreshold normalized to MINIMUM_TRADE_CONFIDENCE (60).
  - goal-session-live-engine.ts: shouldBlockExecution guard removed.
  - alpha-execution-planner.ts: shouldBlockExecution throw removed.
  - Planning prompt: "Min Confidence" line removed.

  ### 2. Deferred / Wait-Entry Mode — REMOVED
  - WAIT_ENTRY and WAIT_HIGHER_EDGE no longer map to MONITORED execution.
  - executionMode is always IMMEDIATE.
  - Alpha valid outputs: EXECUTE_NOW, EXECUTE_NOW_WITH_PULLBACK, NO_TRADE.

  ### 3. Circuit Breaker Silent Drop — REMOVED
  - When isCircuitBroken=true, execution is no longer silently dropped.
  - Circuit breaker is diagnostic-only: logs loud ERROR, execution continues.

  ## SSOT Compliance
  - Confidence gate SSOT: best-symbol-selector.ts via ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE = 60
  - No data-integrity validators changed.
  - No confidence penalties changed (already advisory-only).

  ## Schema Changes
  1. Adds 'alpha_execution_policy' to valid_entity_type constraint.
  2. Adds 'ccip_policy_removal' to valid_operation constraint.
*/

-- Extend valid_entity_type
ALTER TABLE governance_change_log DROP CONSTRAINT IF EXISTS valid_entity_type;
ALTER TABLE governance_change_log ADD CONSTRAINT valid_entity_type CHECK (entity_type = ANY (ARRAY[
  'goal_sessions', 'goal_session_trades', 'entry_intents', 'user_profiles',
  'pending_user_modals', 'trade_processing_lock', 'database_migration',
  'system_configuration', 'club_token_balances', 'ai_trader_score',
  'timeout_governance_config', 'alpha_coordinator', 'realtime_intelligence_calculator',
  'alpha_wall_validation', 'alpha_prompt_config', 'llm_pipeline_governance',
  'alpha_type_contract', 'alpha_freshness_gate', 'alpha_regime_extractor',
  'thesis_immutability_guard', 'alpha_style_authority', 'alpha_execution_policy'
]));

-- Extend valid_operation
ALTER TABLE governance_change_log DROP CONSTRAINT IF EXISTS valid_operation;
ALTER TABLE governance_change_log ADD CONSTRAINT valid_operation CHECK (operation = ANY (ARRAY[
  'status_transition', 'balance_update', 'intent_cleanup', 'intent_execution',
  'modal_creation', 'modal_dismissal', 'timeout_auto_close', 'force_cleanup',
  'trade_closure', 'field_update', 'timestamp_set', 'lock_acquired',
  'lock_attempt_failed', 'lock_released', 'expired_locks_cleanup',
  'ccip_migration_applied', 'configuration_update', 'system_recovery',
  'configuration_change', 'ccip_ssot_fix', 'ccip_policy_removal'
]));

-- Record the governance change
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id,
  metadata
) VALUES (
  'alpha_execution_policy',
  gen_random_uuid(),
  'ccip_policy_removal',
  jsonb_build_object(
    'growth_mode_block', true,
    'wait_entry_deferred_mode', true,
    'circuit_breaker_silent_drop', true,
    'mode_specific_confidence_floors', jsonb_build_object(
      'precision', 80, 'execution', 75, 'campaign', 80, 'growth', 100
    )
  ),
  jsonb_build_object(
    'growth_mode_block', false,
    'wait_entry_deferred_mode', false,
    'circuit_breaker_silent_drop', false,
    'confidence_gate_ssot', 'ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE = 60 in best-symbol-selector.ts',
    'goal_modes', jsonb_build_array('precision', 'execution', 'campaign'),
    'alpha_valid_outputs', jsonb_build_array('EXECUTE_NOW', 'EXECUTE_NOW_WITH_PULLBACK', 'NO_TRADE')
  ),
  'CCIP-2026-03-09: Alpha was silently blocked by 3 independent blockers (growth mode, deferred entry queue, circuit breaker silent drop). All removed per governance directive. Alpha reasons with raw data only.',
  null,
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-09',
    'files_changed', jsonb_build_array(
      'src/services/goal-intelligence-classifier.ts',
      'src/services/goal-session-live-engine.ts',
      'src/services/alpha-execution-planner.ts',
      'src/services/concurrency-limiter-service.ts'
    ),
    'applied_at', now()
  )
);
