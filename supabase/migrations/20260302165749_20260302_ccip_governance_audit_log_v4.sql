/*
  # CCIP 2026-03-02: Governance Audit Log for Trade Protection System

  Records the deployment of all 5 trade protection governance changes using
  valid entity_type and operation values from existing constraints.
*/

INSERT INTO governance_change_log (entity_type, entity_id, operation, old_value, new_value, reason, metadata)
VALUES
  (
    'alpha_coordinator',
    gen_random_uuid(),
    'ccip_migration_applied',
    '{"description": "liquidity_sweep_reversal allowed without BOS confirmation"}',
    '{"description": "liquidity_sweep_reversal hard-blocked when has_bos=false", "block_reason": "SWEEP_RECLAIM_UNCONFIRMED"}',
    'Item 1: Sweep reclaim entry gate — blocks sweep reversal thesis when Omega-8 has_bos=false',
    '{"ccip_date": "2026-03-02", "files_modified": ["src/services/alpha-trade-executor.ts"], "item": 1}'
  ),
  (
    'alpha_coordinator',
    gen_random_uuid(),
    'ccip_migration_applied',
    '{"description": "HTF trend direction only injected as prompt text, not enforced programmatically"}',
    '{"description": "Pre-LLM deterministic HTF conflict gate added", "block_reason": "HTF_CONFLICT_NO_COUNTER_TREND_QUALIFICATION"}',
    'Item 2: HTF regime conflict pre-LLM check — blocks counter-trend entries without structural qualification',
    '{"ccip_date": "2026-03-02", "files_modified": ["src/brains/coordinator-alpha.ts"], "item": 2}'
  ),
  (
    'alpha_coordinator',
    gen_random_uuid(),
    'ccip_migration_applied',
    '{"description": "Sweep buffer had no minimum pip floor"}',
    '{"description": "Minimum pip floor: XAUUSD=8, JPY pairs=5, others=3"}',
    'Item 3: Sweep buffer minimum pip floor — prevents underpowered stop placement on volatile instruments',
    '{"ccip_date": "2026-03-02", "files_modified": ["src/services/risk-aware-stop-calculator.ts"], "item": 3}'
  ),
  (
    'alpha_coordinator',
    gen_random_uuid(),
    'ccip_migration_applied',
    '{"description": "ATR=null caused silent skip of SL move after TP1"}',
    '{"description": "ATR fallback added per symbol class, tp1_action_taken now accurate"}',
    'Item 4: TP1 breakeven enforcement — fixes silent SL move failure when ATR unavailable',
    '{"ccip_date": "2026-03-02", "files_modified": ["src/services/realtime-sltp-monitor.ts", "src/services/monitoring/position-monitoring-authority.ts"], "item": 4}'
  ),
  (
    'alpha_coordinator',
    gen_random_uuid(),
    'ccip_migration_applied',
    '{"description": "Executor had no memory of prior trade outcomes within session"}',
    '{"description": "RecentTradeContext service blocks same-direction re-entry when regime unchanged", "block_reason": "SAME_DIRECTION_REENTRY_NO_REGIME_CHANGE"}',
    'Item 5: Re-entry bias check — prevents compounding losses from repeated same-direction entries after stop-loss',
    '{"ccip_date": "2026-03-02", "files_modified": ["src/services/recent-trade-context.ts", "src/services/alpha-trade-executor.ts"], "item": 5}'
  );
