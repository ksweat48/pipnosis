/*
  ═══════════════════════════════════════════════════════════════════════════
  CCIP FIX: Double-Click Modal Dismissal Issue (2026-02-04)
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem Statement

  Users experienced a bug where the 30-second trade execution countdown modal
  required clicking the "Got It!" button TWICE before the modal would dismiss.

  ## Root Cause Analysis

  ### Duplicate Notification Paths

  The system had TWO realtime subscriptions triggering modals for the same trade:

  1. **Direct Trade Subscription** (src/services/realtime-trade-notification-listener.ts:76-94)
     - Subscribed to `goal_session_trades` INSERT events
     - Triggered `handleTradeInsert()` → called `globalDialogManager.showTradeEntry()`
     - Created Modal #1

  2. **Notification Subscription** (src/services/realtime-trade-notification-listener.ts:97-113)
     - Subscribed to `goal_notifications` INSERT events for 'trade_opened' type
     - Triggered `handleNotificationInsert()` → called `globalDialogManager.showTradeEntry()`
     - Created Modal #2

  ### Sequence of Events

  When Alpha executed a trade:
  1. Trade inserted into `goal_session_trades` → Modal #1 triggered
  2. NotificationCoordinator created 'trade_opened' notification → Modal #2 triggered
  3. Both modals queued almost simultaneously (race condition)
  4. First "Got It!" click dismissed Modal #1
  5. Modal #2 immediately appeared from queue
  6. Second "Got It!" click dismissed Modal #2

  ### Deduplication Logic Failed

  The code had deduplication logic (lines 131-138 and 184-207) but it failed due to:
  - Race condition: Both subscriptions fired before deduplication could prevent the second one
  - Timing issue where both handlers executed before `recentTrades` Set was populated

  ### Secondary Issue: Priority Constraint Violations

  Console logs showed constraint violations:
  - `Error: new row for relation "goal_notifications" violates check constraint "goal_notifications_priority_check"`

  The TypeScript code used priority='urgent' but the database constraint only allowed 'critical'.
  (This was already fixed in migration 20260116041515_fix_goal_notifications_priority_add_critical.sql)

  ## Solution - SSOT Compliance

  ### Files Modified

  #### 1. src/services/realtime-trade-notification-listener.ts

  **REMOVED:**
  - Direct subscription to `goal_session_trades` INSERT events
  - `handleTradeInsert()` method
  - `tradeChannel` property
  - `TradeRecord` interface

  **KEPT:**
  - Subscription to `goal_notifications` INSERT events (SSOT)

  **IMPROVED:**
  - Enhanced deduplication using notification ID + type composite key
  - Increased DEDUPE_WINDOW_MS from 5s to 10s
  - Changed priority from 'urgent' to 'critical' for DB compliance

  **Result:** Only ONE subscription path exists, preventing duplicate modals

  #### 2. src/services/global-dialog-manager.ts

  **ADDED:**
  - DialogPriority type: 'low' | 'medium' | 'high' | 'critical'
  - Deduplication logic in `showDialog()` method
  - `createDedupeKey()` method for composite key generation
  - `recentDialogs` Set with 10-second cleanup
  - Queue inspection to prevent adding duplicate dialogs

  **CHANGED:**
  - All method signatures from 'urgent' to 'critical'
  - showTradeEntry() default priority: 'critical'
  - showTP1HitDialog() default priority: 'critical'

  **Result:** Multiple layers of deduplication prevent any duplicate modals

  #### 3. src/services/modal-notification-bridge.ts

  **ADDED:**
  - Priority mapping: 'urgent' → 'critical' for legacy compatibility
  - Type import: DialogPriority from global-dialog-manager

  **CHANGED:**
  - NotificationPayload.priority type: 'low' | 'medium' | 'high' | 'critical'
  - mapDialogToNotification() explicitly maps 'urgent' to 'critical'

  **Result:** No constraint violations when persisting notifications

  ## SSOT Principles Applied

  1. **Single Source of Truth for Modal Triggers**
     - goal_notifications is now the ONLY trigger for trade entry modals
     - No direct subscription to goal_session_trades
     - NotificationCoordinator creates notifications → Listener triggers modals

  2. **Single Responsibility**
     - realtimeTradeNotificationListener: Subscribe to notifications only
     - NotificationCoordinator: Create notifications
     - GlobalDialogManager: Display modals with deduplication

  3. **Type Safety**
     - DialogPriority type aligns with database constraint
     - Legacy 'urgent' values mapped to 'critical'
     - No more constraint violations

  ## Governance Compliance

  1. **Change Control**
     - Root cause identified and documented
     - All affected files listed with specific changes
     - SSOT violations corrected

  2. **Architecture Compliance**
     - Removed duplicate responsibility (two subscriptions)
     - Established clear authority (goal_notifications is SSOT)
     - Added safety nets (multiple deduplication layers)

  3. **Regression Prevention**
     - Deduplication at notification level (realtime listener)
     - Deduplication at dialog level (global dialog manager)
     - 10-second deduplication window for safety
     - Composite keys prevent false positives

  ## Verification Checklist

  - ✅ Only ONE subscription exists for trade modals (goal_notifications)
  - ✅ No direct subscription to goal_session_trades remains
  - ✅ Deduplication works at both notification and dialog levels
  - ✅ Priority values align with database constraint (critical not urgent)
  - ✅ No constraint violation errors in console
  - ✅ Modal dismisses on FIRST "Got It!" click
  - ✅ No duplicate modals appear in queue

  ## Expected Behavior After Fix

  When Alpha executes a trade:
  1. Trade inserted into goal_session_trades
  2. NotificationCoordinator creates 'trade_opened' notification
  3. Realtime listener receives notification INSERT
  4. Deduplication checks pass (first time seeing this notification)
  5. globalDialogManager.showTradeEntry() called with priority='critical'
  6. Deduplication in showDialog() confirms not a duplicate
  7. Modal appears with 30-second countdown
  8. User clicks "Got It!" once → modal dismisses immediately
  9. No second modal appears

  ## Migration Type: Documentation Only

  This migration contains no SQL changes. All fixes were implemented in TypeScript.
  The database constraint for priority values was already fixed in migration:
  20260116041515_fix_goal_notifications_priority_add_critical.sql

  This migration exists solely to document the fix following CCIP protocol.

  ═══════════════════════════════════════════════════════════════════════════
*/

-- No SQL changes required - this is a documentation-only CCIP migration
-- All fixes were implemented in TypeScript files

SELECT 'CCIP documentation migration - no database changes' AS status;