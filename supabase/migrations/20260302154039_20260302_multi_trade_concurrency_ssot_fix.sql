/*
  # CCIP Governance Audit — Multi-Trade Concurrency SSOT Fix

  ## Title
  Multi-Trade Concurrency DB/Engine Mismatch — CCIP-MULTI-TRADE-2026-03-02

  ## Plain English Summary
  A critical bug caused the multi-trade mode to only execute 1 trade even when the
  user had the "Multi-Trade" toggle switched ON.

  The root cause was a split-brain between two values that MUST always be identical:

  1. `goal_sessions.max_concurrent_trades` — stored as **3** when multi-trade is ON
  2. In-memory `GoalSessionLiveConfig.maxConcurrentTrades` — was set to **2**

  The DB-backed concurrency gate in `processMultiSymbolCycle` reads
  `tradeCount >= config.maxConcurrentTrades`.  With the in-memory value at 2, scanning
  was permanently blocked after 2 open trades, so trade 3 was never reached even
  though the DB said it was allowed.

  ## Fix Applied (Frontend — no schema change needed)
  - `smart-goal-session-manager.ts`: `startLiveEngine` now passes `maxConcurrentTrades = 3`
    (was 2) when multi-trade is enabled — matching the DB insert on the same class.
  - `SmartGoalPanel.tsx`: `handleCreateSession` now re-reads `trading_preferences.multiTradeMode`
    from the DB immediately before calling `createSmartGoalSession`, eliminating any race
    where the realtime subscription had not yet fired after a Settings change.

  ## SSOT Governance Rule
  The in-memory `GoalSessionLiveConfig.maxConcurrentTrades` MUST always equal
  `goal_sessions.max_concurrent_trades` as written at session creation.
  These two values are the SSOT for multi-trade concurrency limits.
  Any future change to one MUST update the other in the same commit/PR.

  ## Affected Source Files
  - src/services/smart-goal-session-manager.ts (startLiveEngine)
  - src/components/SmartGoalPanel.tsx (handleCreateSession)

  ## Security
  No RLS changes required — audit record only.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
)
VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  jsonb_build_object(
    'maxConcurrentTrades_in_memory', 2,
    'max_concurrent_trades_in_db', 3,
    'ccip_ref', 'CCIP-MULTI-TRADE-2026-03-02',
    'description', 'In-memory engine config diverged from DB: engine capped at 2, DB allowed 3, causing trade 3 to never execute'
  ),
  jsonb_build_object(
    'maxConcurrentTrades_in_memory', 3,
    'max_concurrent_trades_in_db', 3,
    'ccip_ref', 'CCIP-MULTI-TRADE-2026-03-02',
    'description', 'Aligned: in-memory engine config now matches DB — both 3 when multi-trade ON',
    'ssot_rule', 'startLiveEngine maxConcurrentTrades MUST always equal max_concurrent_trades written to goal_sessions at session creation',
    'affected_files', jsonb_build_array(
      'src/services/smart-goal-session-manager.ts (startLiveEngine)',
      'src/components/SmartGoalPanel.tsx (handleCreateSession — DB re-read before session start)'
    )
  ),
  'CCIP-MULTI-TRADE-2026-03-02: Multi-trade mode was stopping after 1 trade despite toggle ON. Root cause: startLiveEngine passed maxConcurrentTrades=2 while createSmartGoalSession wrote max_concurrent_trades=3 to DB. DB-backed concurrency gate permanently blocked trade 3. Fix: aligned both to 3. Also hardened SmartGoalPanel to re-read toggle from DB at session-start to prevent subscription race.'
);
