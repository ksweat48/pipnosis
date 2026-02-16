/*
  # CCIP Governance: Alpha Sole TP Authority

  ## Summary
  Records the governance change that restores Alpha (LLM) as the sole authority
  for all take-profit (TP) values.

  ## Changes
  1. Expand valid_entity_type constraint to include alpha_coordinator
  2. Record the governance change in the audit log

  ## Governance Rules (Enforced)
  - SCALP: Alpha returns 1 TP (takeProfit = TP1). No TP2.
  - MICRO_INTRADAY/INTRADAY: Alpha returns tp1 + tp2 (dual targets).
  - System validates against arena walls but NEVER computes TP values.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'governance_change_log' AND constraint_name = 'valid_entity_type'
  ) THEN
    ALTER TABLE governance_change_log DROP CONSTRAINT valid_entity_type;
    ALTER TABLE governance_change_log ADD CONSTRAINT valid_entity_type CHECK (
      entity_type IN (
        'goal_sessions',
        'goal_session_trades',
        'entry_intents',
        'user_profiles',
        'pending_user_modals',
        'trade_processing_lock',
        'database_migration',
        'system_configuration',
        'club_token_balances',
        'ai_trader_score',
        'timeout_governance_config',
        'alpha_coordinator'
      )
    );
  END IF;
END $$;

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'configuration_update',
  '{"tp1_source": "tp1ProbabilityCalculator", "tp2_source": "alpha_takeProfit", "fallback": "60pct_of_tp", "scalp_override": "system_replaces_alpha_tp"}',
  '{"tp1_source": "alpha_llm_response", "tp2_source": "alpha_llm_response", "fallback": "none", "scalp_override": "none"}',
  'CCIP 2026-02-16: Restored Alpha as sole authority for TP1/TP2. Removed tp1ProbabilityCalculator, fallback computation, SCALP override, calculateDualTargets bypass.',
  '{"files_affected": ["coordinator-alpha.ts", "goal-session-live-engine.ts"], "ssot_authority": "coordinator-alpha.ts:parseDecision", "severity": "critical"}'::jsonb
);
