/*
  # CCIP Fix: Double Modal Deduplication and AI Learning Engine 400 Errors

  ## Summary
  Two production bugs fixed in this migration:

  ### 1. Double Modal Popup (SSOT Violation)
  The "Manually Closed" trade modal was appearing twice with ~3 second delay.

  Root cause: Two independent code paths both trigger `showTradeClosed` for the same trade:
  - Path A: position-monitor creates a persistent modal in `pending_user_modals`,
    App.tsx picks it up via Realtime subscription and displays it immediately.
  - Path B: `trade-closure-coordinator` subscribes to `trade_closure_events` Realtime
    and calls `globalDialogManager.showTradeClosed()` directly ~3s later.

  Fix:
  - GlobalDialogManager dedup key now includes `trade_id` (was only `type-symbol`)
  - Dedup window extended from 10s to 30s (covers Supabase Realtime propagation delay)
  - All createTradeClosedModal calls now include `trade_id` in modal_data
  - App.tsx passes `tradeId` from modal_data when calling showTradeClosed from queue

  ### 2. AI Learning Engine 400 Errors
  - ai_trade_analysis: NULL guards on direction/entry_confidence NOT NULL columns
  - ai_market_scenario_performance: Changed INSERT to UPSERT (unique constraint violation)
  - trade_learning_log: NULL guard on position_type NOT NULL column

  ## CCIP Governance
  - Change ID: CCIP-2026-02-19-001
  - Change Type: Bug Fix (Production)
  - No schema changes required — all fixes are in the frontend service layer
  - All changes are backward compatible with zero data loss risk
*/

-- Audit trail for CCIP compliance
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id
)
VALUES (
  'pending_user_modals',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"dedupe_window_ms": 10000, "dedupe_key": "type-symbol", "ai_learning_insert": "plain_insert"}'::jsonb,
  '{"dedupe_window_ms": 30000, "dedupe_key": "type-tradeId", "ai_learning_insert": "upsert_with_null_guards", "ccip_id": "CCIP-2026-02-19-001"}'::jsonb,
  'Double modal popup ~3s after dismissal (dual Realtime paths); AI learning 400s (NULL column values + missing UPSERT on unique constraint)',
  NULL
);
