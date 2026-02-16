/*
  # CCIP Governance: Omega Intelligence Evolution & Risk Mode Fix
  
  ## Summary
  Documents major architectural changes under CCIP governance:
  
  1. **Omega Intelligence Evolution**
     - All 6 Omega specialists converted from voters to intelligence providers
     - vote/confidence deprecated, return reasoning/evidence/keyFactors only
     - Alpha is sole directional decision maker
     - Omega conflict detection removed
  
  2. **Risk Mode Handoff Fix**
     - ProfessionalRiskManager respects user's chosen risk as TRUE ceiling
  
  3. **Learning Data Pipeline Fix**
     - arena_chosen and wall_violations persisted to alpha_decisions
  
  4. **Style Mapping Fix**
     - normalizeTradeStyle() handles aliases (scalper->SCALP)
  
  ## Security
  - No RLS changes, no new tables
*/

INSERT INTO governance_change_log (entity_type, entity_id, operation, old_value, new_value, reason, metadata)
VALUES 
(
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"component": "omega_architecture", "role": "directional_voters", "conflict_detection": true}'::jsonb,
  '{"component": "omega_architecture", "role": "intelligence_providers", "conflict_detection": false}'::jsonb,
  'CCIP: Omega specialists evolved from directional voters to pure intelligence providers. Alpha proven correct overriding 5 omega BUY votes to SELL XAUUSD (+$493.20).',
  '{"ccip_tier": "architectural", "affected_files": ["types/omega-vote.ts", "types/omega.ts", "brains/omega/*.ts", "omega8-hybrid-orderflow.ts", "alpha-omega-orchestrator.ts", "coordinator-alpha.ts", "omega-alpha-logger.ts"]}'::jsonb
),
(
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"component": "risk_management", "riskMode_passed": false, "effective_max": "1.5%"}'::jsonb,
  '{"component": "risk_management", "riskMode_passed": true, "effective_max": "user_chosen"}'::jsonb,
  'CCIP: Fixed risk mode handoff. User chose 5% aggressive but system capped to 1.5%. Now respects user choice as ceiling.',
  '{"ccip_tier": "critical_fix", "affected_files": ["smart-goal-session-manager.ts", "professional-risk-manager.ts"]}'::jsonb
),
(
  'system_configuration',
  gen_random_uuid(),
  'field_update',
  '{"component": "learning_pipeline", "arena_chosen": "not_persisted", "wall_violations": "not_persisted"}'::jsonb,
  '{"component": "learning_pipeline", "arena_chosen": "persisted", "wall_violations": "persisted"}'::jsonb,
  'CCIP: Fixed learning data pipeline. arena_chosen and wall_violations now persisted. Intelligence logged instead of votes.',
  '{"ccip_tier": "data_integrity", "affected_files": ["omega-alpha-logger.ts", "coordinator-alpha.ts"]}'::jsonb
),
(
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"component": "style_mapping", "scalper_recognized": false}'::jsonb,
  '{"component": "style_mapping", "scalper_recognized": true, "aliases": {"scalper": "SCALP", "micro": "MICRO_INTRADAY"}}'::jsonb,
  'CCIP: Fixed style mapping. Added normalizeTradeStyle() for aliases like scalper->SCALP.',
  '{"ccip_tier": "bug_fix", "affected_files": ["session-constraint-coordinator.ts"]}'::jsonb
);
