/*
  # CCIP-2026-0308B: CanonicalStyle SSOT Consolidation

  ## Summary
  Resolves 3 active SSOT violations where `CanonicalStyle` type and style alias
  normalization logic were duplicated across multiple files instead of being owned
  exclusively by `timeframe-hierarchy.ts`.

  ## SSOT Violations Fixed

  1. alpha-trade-executor.ts — removed local CanonicalStyle + normalizeToCanonicalStyle()
  2. style-qualification-gate.ts — removed local CanonicalStyle type
  3. trade-style-registry.ts — removed competing alias map, delegates to resolveCanonicalStyle()
  4. entry-intent-monitor-mode.ts — imports CanonicalStyle from timeframe-hierarchy.ts

  ## Governance Compliance
  - New entity_type 'alpha_style_authority' added to valid_entity_type constraint
  - New operation 'ccip_ssot_fix' added to valid_operation constraint
  - Both CCIP refs logged to governance_change_log

  ## Risk Level: LOW | Breaking Changes: None
*/

-- Extend valid_entity_type constraint to include alpha_style_authority
ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_entity_type CHECK (entity_type = ANY (ARRAY[
    'goal_sessions'::text,
    'goal_session_trades'::text,
    'entry_intents'::text,
    'user_profiles'::text,
    'pending_user_modals'::text,
    'trade_processing_lock'::text,
    'database_migration'::text,
    'system_configuration'::text,
    'club_token_balances'::text,
    'ai_trader_score'::text,
    'timeout_governance_config'::text,
    'alpha_coordinator'::text,
    'realtime_intelligence_calculator'::text,
    'alpha_wall_validation'::text,
    'alpha_prompt_config'::text,
    'llm_pipeline_governance'::text,
    'alpha_type_contract'::text,
    'alpha_freshness_gate'::text,
    'alpha_regime_extractor'::text,
    'thesis_immutability_guard'::text,
    'alpha_style_authority'::text
  ]));

-- Extend valid_operation constraint to include ccip_ssot_fix
ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_operation;

ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_operation CHECK (operation = ANY (ARRAY[
    'status_transition'::text,
    'balance_update'::text,
    'intent_cleanup'::text,
    'intent_execution'::text,
    'modal_creation'::text,
    'modal_dismissal'::text,
    'timeout_auto_close'::text,
    'force_cleanup'::text,
    'trade_closure'::text,
    'field_update'::text,
    'timestamp_set'::text,
    'lock_acquired'::text,
    'lock_attempt_failed'::text,
    'lock_released'::text,
    'expired_locks_cleanup'::text,
    'ccip_migration_applied'::text,
    'configuration_update'::text,
    'system_recovery'::text,
    'configuration_change'::text,
    'ccip_ssot_fix'::text
  ]));

-- Log the CanonicalStyle SSOT consolidation
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
  'alpha_style_authority',
  gen_random_uuid(),
  'ccip_ssot_fix',
  '{"ccip_ref": "CCIP-2026-0308B", "violation": "CanonicalStyle defined in 3 files: alpha-trade-executor.ts, style-qualification-gate.ts, trade-style-registry.ts (competing alias map)"}'::jsonb,
  '{"ccip_ref": "CCIP-2026-0308B", "resolution": "All consumers import CanonicalTradeStyle from timeframe-hierarchy.ts. trade-style-registry.ts retains StyleConfig authority only."}'::jsonb,
  'CCIP-2026-0308B: CanonicalStyle SSOT consolidation — eliminated 3 duplicate type definitions and 1 competing alias map',
  jsonb_build_object(
    'ccip_ref', 'CCIP-2026-0308B',
    'files_changed', ARRAY[
      'src/services/alpha-trade-executor.ts',
      'src/services/style-qualification-gate.ts',
      'src/services/trade-style-registry.ts',
      'src/services/entry-intent-monitor-mode.ts',
      'src/governance/RESPONSIBILITY_REGISTRY.md'
    ],
    'ssot_authority', 'src/config/timeframe-hierarchy.ts',
    'violations_fixed', 3,
    'breaking_changes', false,
    'risk_level', 'LOW'
  )
),
(
  'alpha_style_authority',
  gen_random_uuid(),
  'ccip_ssot_fix',
  '{"ccip_ref": "CCIP-2026-0308A", "status": "authority_undocumented"}'::jsonb,
  '{"ccip_ref": "CCIP-2026-0308A", "authority": "alpha-adaptive-floor-service.ts", "rails_ssot": "alpha-identity.ts ADAPTIVE_FLOOR_RAILS", "audit_table": "alpha_confidence_floor_adjustments"}'::jsonb,
  'CCIP-2026-0308A: Registering AlphaAdaptiveFloorService as formal SSOT for confidence floor management',
  jsonb_build_object(
    'ccip_ref', 'CCIP-2026-0308A',
    'service', 'src/services/alpha-adaptive-floor-service.ts',
    'rails_source', 'src/config/alpha-identity.ts',
    'schema_migration', '20260308013225_20260308_adaptive_confidence_floor_bidirectional',
    'hard_min', 50,
    'hard_max', 75,
    'step_size', 5,
    'risk_level', 'LOW'
  )
);
