/*
  # CCIP Governance Audit: P&L Sign Fix and Per-Symbol Alpha Reasoning

  ## Change Intent (CCIP Compliance)
  This migration documents two SSOT-compliant fixes deployed in this cycle:

  1. P&L Sign Fix (GoalSessionDashboard.tsx)
     - PROBLEM: calculateCurrentPnL used unsigned pipDist * dollarPerPip. SELL trades at a loss
       showed positive P&L. The pips display variable also used unsigned calculatePipDistance().
     - FIX: Routes through canonical calculatePnL() in src/types/position.ts which correctly
       applies direction sign. pips display derives from currentPnL / dollarPerPip (signed).
     - SSOT OWNER: calculatePnL() in src/types/position.ts -> currencyHelpers.ts

  2. Per-Symbol Alpha Reasoning in Thought Monitor (goal-session-live-engine.ts)
     - PROBLEM: decision.reasoning per symbol was only console.logged, not shown in Thought Monitor.
     - FIX: emitSymbolReasoning() added to AlphaThoughtStream, reuses 'comparing' step type
       (already in DB constraint - no schema change). Engine loops filteredDecisions before
       emitFinalDecision. No-trade branch builds per-symbol summary.
     - SSOT OWNER: alpha-thought-stream.ts -> alpha_scan_thoughts table
     - NO SCHEMA CHANGE: 'comparing' step type reused.

  ## Affected Files
  - src/components/GoalSessionDashboard.tsx
  - src/services/alpha-thought-stream.ts
  - src/services/goal-session-live-engine.ts
*/

-- ✅ CCIP AUDIT: Record governance change using valid operation 'ccip_migration_applied'
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
SELECT
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'component', 'GoalSessionDashboard.calculateCurrentPnL',
    'issue', 'unsigned_pnl_sell_trades_showed_positive_loss',
    'secondary_issue', 'per_symbol_reasoning_not_surfaced_in_thought_monitor'
  ),
  jsonb_build_object(
    'pnl_fix', 'routes_through_calculatePnL_in_position_ts',
    'pips_fix', 'derives_sign_from_currentPnL_divided_by_dollarPerPip',
    'thought_monitor_fix', 'emitSymbolReasoning_added_reuses_comparing_step_type'
  ),
  'CCIP fix: P&L sign correctness and per-symbol Alpha reasoning transparency',
  jsonb_build_object(
    'ccip_stage', 'staged_deployment',
    'affected_files', ARRAY[
      'src/components/GoalSessionDashboard.tsx',
      'src/services/alpha-thought-stream.ts',
      'src/services/goal-session-live-engine.ts'
    ],
    'db_schema_changed', false,
    'step_type_reused', 'comparing',
    'ssot_owners', ARRAY[
      'src/types/position.ts::calculatePnL',
      'src/utils/currencyHelpers.ts::calculateDollarPerPip',
      'src/services/alpha-thought-stream.ts::emitSymbolReasoning'
    ]
  )
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'governance_change_log'
);
