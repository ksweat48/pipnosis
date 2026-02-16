/*
  # CCIP Governance: Scalp Trades Use Single TP (TP1 Only)

  ## Change Summary
  Scalp-style trades now close at TP1 (the high-probability conservative target)
  rather than waiting for TP2 (the full profit target). This policy change recognizes
  that TP1 is most frequently hit in scalp trades and keeping positions open for TP2
  extends exposure beyond what the scalp style warrants.

  ## Policy Rules
  - SCALP trades: TP1 only (tp2_price = NULL, take_profit = TP1 level)
  - MICRO / INTRADAY trades: Dual TP retained (TP1 milestone + TP2 close target)

  ## Enforcement Layers
  1. coordinator-alpha.ts: SSOT authority
  2. goal-session-live-engine.ts: Session engine
  3. alpha-trade-executor.ts: Defensive guard
  4. smart-goal-session-manager.ts: Session creation
  5. GoalSessionDashboard.tsx: UI conditional rendering

  ## CCIP Compliance
  - No database schema changes
  - No destructive operations
  - Existing open scalp trades unaffected
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  new_value,
  metadata
) VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  'CCIP: Scalp trades now use single TP (TP1 only). TP2 suppressed for SCALP style. Micro and Intraday retain dual TP.',
  jsonb_build_object(
    'scalp_tp2_enabled', false,
    'micro_tp2_enabled', true,
    'intraday_tp2_enabled', true
  ),
  jsonb_build_object(
    'ccip_version', '2026-02-16',
    'affected_styles', jsonb_build_array('SCALP'),
    'unaffected_styles', jsonb_build_array('MICRO_INTRADAY', 'INTRADAY'),
    'enforcement_layers', jsonb_build_array(
      'coordinator-alpha.ts (SSOT)',
      'goal-session-live-engine.ts',
      'alpha-trade-executor.ts (defensive)',
      'smart-goal-session-manager.ts',
      'GoalSessionDashboard.tsx (UI)'
    ),
    'rationale', 'TP1 is most frequently hit in scalp trades. TP2 keeps scalp positions open longer than the style warrants.',
    'monitoring_impact', 'Position monitoring falls to legacy single TP path (take_profit = TP1 level)',
    'backwards_compatible', true,
    'existing_trades_affected', false
  )
);
