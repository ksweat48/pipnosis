/*
  # CCIP Governance: Double Sound Fix - Comprehensive Audio Authority Fix

  ## Problem Statement

  Users reported hearing double audio alerts when trade notifications appeared,
  specifically a "beep beep" sound on trade entry modals. Investigation revealed
  a three-layer architectural violation of SSOT (Single Source of Truth) principles
  in the notification and audio playback systems.

  ## Root Cause Analysis

  ### Primary Cause: Circular Notification Insert

  When globalDialogManager.showDialog() was called (triggered by realtime listener
  receiving a trade_opened INSERT), it called modalNotificationBridge.captureDialog()
  which inserted ANOTHER record into goal_notifications. This second insert fired
  another realtime event, creating an unpredictable circular insert pattern.

  **SSOT Violation:** notificationCoordinator is documented as SSOT for goal_notifications
  inserts ("ALL notifications MUST go through this coordinator. DO NOT insert into
  goal_notifications directly elsewhere"). The bridge was bypassing this authority.

  ### Secondary Cause: Dialog Queue Cascade

  When closeDialog() was called on "Got It" click, it checked the dialog queue and
  immediately emitted the next queued dialog if present. The useGlobalDialog hook's
  audio handler fired for this automatically-advanced dialog, producing a second sound
  on user action.

  **UX Violation:** Queued dialogs are follow-up items the user hasn't requested yet.
  Playing audio for automatic queue advancement is jarring and confusing.

  ### Tertiary Cause: TradeSignalNotificationBar Double Audio

  The TradeSignalNotificationBar component played its own audio (line 72) with a
  unique context key (trade_signal:${symbol}:${Date.now()}), while useGlobalDialog
  ALSO played audio for it (lines 57-60) with a different context key. The Date.now()
  in the component's key bypassed deduplication entirely.

  **SSOT Violation:** Two independent audio sources for the same dialog type. The
  component's role is rendering UI, not triggering audio.

  ### Quaternary Cause: AudioContext Suspended State

  Modern browsers create AudioContexts in suspended state. Without explicit .resume(),
  scheduled oscillators may not play until a user gesture, creating unpredictable
  timing behavior where delayed playback overlaps with other events.

  ## Fix Implementation

  ### Fix 1: Break Circular Insert (SSOT Enforcement)

  **Modified:** src/services/global-dialog-manager.ts

  - Added `ShowDialogOptions` interface with `skipPersist` flag
  - When skipPersist=true, showDialog() does NOT call modalNotificationBridge.captureDialog()
  - The notification record already exists from notificationCoordinator - no duplication
  - Updated all wrapper methods (showTradeEntry, showTradeClosed, etc.) to accept options

  **Authority Clarification:**
  - notificationCoordinator: SSOT for goal_notifications database inserts
  - modalNotificationBridge: SSOT for UI persistence ONLY when triggered by direct code
  - Realtime listener: Responds to existing notifications, NEVER creates new ones

  ### Fix 2: Silent Queue Advancement

  **Modified:** src/services/global-dialog-manager.ts

  - Added `_fromQueue` boolean to DialogData interface
  - When closeDialog() advances from queue, it sets nextDialog._fromQueue = true
  - This flag distinguishes "new event dialog" from "automatic queue advancement"

  **Modified:** src/hooks/useGlobalDialog.tsx

  - Added check for dialog._fromQueue in handleDialog callback
  - When _fromQueue is true, audio playback is skipped entirely
  - Only NEW events (not queue advancements) trigger audio

  **UX Improvement:** "Got It" button now silently advances to next dialog without sound.

  ### Fix 3: Remove TradeSignalNotificationBar Audio

  **Modified:** src/components/TradeSignalNotificationBar.tsx

  - Removed the useEffect block (lines 66-79) that called audioAlertService.playWithContext()
  - The useGlobalDialog hook is SSOT for all dialog audio triggers
  - Component responsibility limited to UI rendering only

  **SSOT Compliance:** One audio source per dialog type - the hook owns all audio.

  ### Fix 4: Realtime Listener skipPersist Integration

  **Modified:** src/services/realtime-trade-notification-listener.ts

  - Updated all globalDialogManager calls to pass { skipPersist: true }
  - trade_opened, trade_closed, stop_loss_hit, take_profit_hit, tp1_hit
  - These events ARE the notification inserts - no re-insertion needed

  **Flow Diagram:**
  1. notificationCoordinator.send() -> INSERT into goal_notifications
  2. Realtime event fires -> realtimeTradeNotificationListener receives INSERT
  3. Listener calls globalDialogManager.showTradeEntry(..., { skipPersist: true })
  4. Dialog shows WITHOUT creating duplicate notification (skipPersist prevents it)
  5. useGlobalDialog plays audio (if not _fromQueue)

  ### Fix 5: AudioContext Resume on Init

  **Modified:** src/services/audio-alert-service.ts

  - Added explicit audioContext.resume() after AudioContext creation
  - Checks if context.state === 'suspended' before resuming
  - Ensures first sound plays reliably without waiting for user gesture

  **Browser Compatibility:** Handles modern browser autoplay policies correctly.

  ## Files Modified

  1. src/services/global-dialog-manager.ts
     - Added ShowDialogOptions interface with skipPersist flag
     - Modified showDialog() to skip captureDialog() when skipPersist=true
     - Modified closeDialog() to add _fromQueue flag on queue advancement
     - Updated all wrapper methods to accept options parameter

  2. src/services/realtime-trade-notification-listener.ts
     - Updated all globalDialogManager calls to pass { skipPersist: true }
     - Prevents circular notification inserts from realtime event handlers

  3. src/hooks/useGlobalDialog.tsx
     - Added _fromQueue check in handleDialog callback
     - Skips audio playback when dialog is from automatic queue advancement

  4. src/components/TradeSignalNotificationBar.tsx
     - Removed internal audio useEffect (lines 66-79)
     - Delegates all audio to useGlobalDialog hook

  5. src/services/audio-alert-service.ts
     - Added audioContext.resume() in initialize() method
     - Ensures AudioContext is ready before first sound plays

  ## Testing Recommendations

  1. Trigger trade entry notification - verify single beep sound
  2. Queue multiple notifications - verify "Got It" advances silently
  3. Test trade_signal notifications - verify single audio playback
  4. Test goal achievement - verify single critical sound
  5. Test audio on first page load - verify sound plays immediately

  ## SSOT Authority Diagram

  ```
  Database Insert Authority:
    notificationCoordinator (SSOT) -> goal_notifications INSERT

  Realtime Event Flow:
    goal_notifications INSERT -> Realtime listener receives event

  Dialog Display Authority:
    globalDialogManager (SSOT) -> Shows modal based on notification
    - If triggered by realtime: skipPersist=true (no duplicate insert)
    - If triggered by code: skipPersist=false (bridge persists for later)

  Audio Playback Authority:
    useGlobalDialog hook (SSOT) -> Plays audio for all dialog types
    - Skips audio when dialog._fromQueue=true (silent advancement)
    - audioAlertService provides deduplication and sound generation
  ```

  ## Previous Fix Attempts

  This fix supersedes and completes:
  - 2026-02-04: Fixed double-modal issue (removed duplicate subscription)
  - 2026-02-10: Attempted sound fix (routed through central audio service)
  - 2026-02-13: Removed showTradeEntry from trade-lifecycle-manager

  Those fixes were insufficient because they didn't address the circular insert
  pattern or the queue cascade audio issue. This comprehensive fix addresses all
  three root causes in the audio pipeline.

  ## CCIP Compliance

  ✅ SSOT Enforcement: notificationCoordinator is sole authority for DB inserts
  ✅ SSOT Enforcement: useGlobalDialog is sole authority for dialog audio
  ✅ Architectural Clarity: Clear responsibility boundaries between services
  ✅ Non-Regression: Preserves all notification functionality
  ✅ Graceful Degradation: Continues working if realtime unavailable

  ## Impact Analysis

  - Eliminates double-sound bug for all notification types
  - Eliminates circular notification inserts (reduces DB load)
  - Improves UX: Silent queue advancement on "Got It" click
  - Improves audio reliability: AudioContext properly initialized
  - Maintains backward compatibility: All existing notification flows preserved
*/

SELECT 'CCIP governance migration: double_sound_fix_comprehensive applied' AS status;
