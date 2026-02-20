/*
  # CCIP Governance Record: Dual Modal Fix (2026-02-20)

  ## Title
  Dual Trade-Closed Modal Root Cause Fix — SSOT & CCIP Compliance

  ## Problem Summary
  When a user manually closes a trade, TWO "Trade Closed" modal popups appeared.

  ## Root Causes Identified

  ### Root Cause 1 — Circular goal_notifications Insert (PRIMARY BUG)
  The App.tsx pending modal recovery path called `globalDialogManager.showTradeClosed()`
  WITHOUT `skipPersist: true`. This caused `GlobalDialogManager.showDialog()` to invoke
  `modalNotificationBridge.captureDialog()`, which inserted a row into `goal_notifications`.
  That insert immediately triggered `realtimeTradeNotificationListener.handleNotificationInsert()`
  which called `showTradeClosed()` a SECOND time on the same trade.

  Even though `GlobalDialogManager` has a 30-second dedup window, the dedup key was already
  cleared (or not yet set, depending on timing) when the realtime event arrived ~3-5 seconds
  after the first modal was displayed, allowing a second modal through.

  ### Root Cause 2 — Broken Subscription Wiring (SECONDARY BUG)
  In App.tsx, the subscription setup code was:
    `const { modalQueueManager } = import('./services/modal-queue-manager').then(...)`
  This destructured the Promise object itself (not the resolved module), so
  `subscribeToModalUpdates()` was silently never called. The reactive modal trigger
  on `pending_user_modals` INSERT was permanently broken.

  ### Root Cause 3 — Missing tradeId snake_case Fallback (TERTIARY BUG)
  `realtimeTradeNotificationListener` only read `notification.metadata?.tradeId` (camelCase).
  When the `notificationCoordinator` wrote metadata with `trade_id` (snake_case), the dedup
  key resolved to `trade_closed-undefined` instead of `trade_closed-<uuid>`, bypassing the
  GlobalDialogManager 30-second dedup window entirely.

  ## Fixes Applied

  ### Fix 1 — App.tsx: Add skipPersist:true to pending modal recovery path
  File: src/App.tsx
  Change: `globalDialogManager.showTradeClosed({...})` → `globalDialogManager.showTradeClosed({...}, { skipPersist: true })`
  Rationale: pending_user_modals is the persistence SSOT. The record already exists.
  Writing to goal_notifications from the recovery path is a circular insert that creates
  a second event stream for the same trade closure.

  ### Fix 2 — App.tsx: Fix broken subscription wiring
  File: src/App.tsx
  Change: `const { modalQueueManager } = import(...)` → `import(...).then(({ modalQueueManager }) => { ... })`
  Rationale: The previous code was a no-op. The subscription must be established so
  checkPendingModals() fires reactively when new pending_user_modals rows are inserted
  mid-session (not only on initial mount).

  ### Fix 3 — realtimeTradeNotificationListener: Add snake_case tradeId fallback
  File: src/services/realtime-trade-notification-listener.ts
  Change: `notification.metadata?.tradeId` → `notification.metadata?.tradeId || notification.metadata?.trade_id`
  Rationale: Both camelCase (from modalNotificationBridge) and snake_case (from
  notificationCoordinator) metadata formats must produce the same dedup key in
  GlobalDialogManager: `trade_closed-<uuid>`.

  ## SSOT Ownership After Fix

  | Responsibility | Authority |
  |---|---|
  | Creating trade_closed persistent modal | tradeClosureCoordinator.createTradeClosedModal() |
  | Recovering pending modal on mount/session | App.tsx checkPendingModals() (skipPersist: true) |
  | Triggering modal from realtime events | realtimeTradeNotificationListener (skipPersist: true) |
  | Deduplication (30s window, tradeId key) | GlobalDialogManager.createDedupeKey() |
  | Writing to goal_notifications | modalNotificationBridge (only from non-recovery paths) |

  ## CCIP Change Tracking
*/

CREATE TABLE IF NOT EXISTS ccip_modal_fix_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_version text NOT NULL DEFAULT '20260220',
  description text NOT NULL,
  files_modified text[] NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ccip_modal_fix_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage ccip modal fix audit"
  ON ccip_modal_fix_audit
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO ccip_modal_fix_audit (description, files_modified)
VALUES (
  'Dual trade-closed modal root cause fix: (1) skipPersist:true on pending modal recovery path to break circular goal_notifications insert; (2) Fixed broken subscribeToModalUpdates() wiring in App.tsx; (3) Added snake_case trade_id fallback in realtimeTradeNotificationListener dedup key resolution.',
  ARRAY[
    'src/App.tsx',
    'src/services/realtime-trade-notification-listener.ts'
  ]
);
