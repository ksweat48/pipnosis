/*
  # Single TP Architecture — CCIP-2026-0527A

  ## Summary
  Removes the dual-TP system (TP1 + TP2) from the application layer.
  Alpha now calculates exactly ONE stop-loss and ONE take-profit per trade.

  ## Root Cause
  Production bug: TP1 placed 1.47 pips from planned entry on XAUUSD SELL.
  Actual fill drifted 2.01 pips, placing TP1 ABOVE entry price.
  Result: instant false "TP1 hit" closure in 1.9 seconds.

  ## Changes (Application Layer Only)
  - Alpha output schema: tp1, tp2, tp1_reasoning, tp2_reasoning REMOVED
  - coordinator-alpha.ts: dual-TP prompt and parsing removed
  - position-monitoring-authority.ts: dual-TP priority checks removed
  - realtime-sltp-monitor.ts: handleTP1Hit/handleTP2Hit methods removed
  - core-validation-gate.ts: tp1/tp2 geometry checks removed
  - alpha-trade-executor.ts: TP1 midpoint governance removed
  - TP1DecisionModal.tsx: DELETED
  - GoalSessionDashboard.tsx: TP1 state/effects/handlers removed
  - alpha-identity.ts: TP1/TP2 references replaced with single-TP language

  ## Database Impact
  - NO columns dropped (backwards-compat with historical trades)
  - Application code stops WRITING to tp1_price, tp2_price, tp1_hit, etc.
  - Historical data remains readable via legacy type annotations
  - close_reason values 'take_profit_1' and 'take_profit_2' remain valid
    for historical records

  ## Governance
  - Single TP stored in existing 'take_profit' column
  - close_reason for TP closure is 'take_profit' (not _1 or _2)
  - partial_close_pct no longer applicable (full close on TP hit)

  ## No DDL Required
  This migration is documentation-only. No schema changes needed because:
  1. Columns are NOT dropped (data safety)
  2. Application already handles null tp1/tp2 values
  3. Constraint changes not needed (existing constraints allow null)
*/

-- Documentation-only migration: CCIP-2026-0527A Single TP Architecture
-- No DDL changes — application layer stops writing TP1/TP2 values
-- Historical data preserved in existing columns

SELECT 1 AS ccip_0527a_single_tp_architecture_applied;
