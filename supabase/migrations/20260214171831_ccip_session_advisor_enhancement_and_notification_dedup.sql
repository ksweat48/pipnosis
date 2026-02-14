/*
  # CCIP Governance: Session Advisor Enhancement + Notification Double-Play Fix

  ## Change 1: Session Advisor Domain Cap Increase (5% -> 15%)

  **Problem:**
  The SessionAdvisor domain in the confidence calculation engine had a 5% penalty cap --
  the weakest of all six domain authorities. This meant session timing mismatches (e.g.,
  21 minutes remaining vs 84 minutes expected fill time) were effectively invisible to
  the confidence engine, allowing marginal trades to pass with comfortable confidence
  scores instead of degrading to borderline.

  **Root Cause:**
  The SessionAdvisor previously only checked for dead_zone sessions (flat 3% penalty).
  It had no awareness of the fill-time-to-session-remaining ratio.

  **Fix:**
  1. Increased SessionAdvisor domain cap from 0.05 (5%) to 0.15 (15%), matching
     RegimeOracle and EQS domain authorities
  2. Replaced flat dead-zone-only trigger with graduated fill-time ratio penalty:
     - Ratio >= 1.0 (enough time): 0% penalty
     - Ratio 0.75-1.0 (tight): 3% penalty
     - Ratio 0.50-0.75 (constrained): 7% penalty
     - Ratio 0.25-0.50 (severely constrained): 12% penalty
     - Ratio < 0.25 (critically insufficient): 15% penalty
  3. Dead zone sessions receive minimum 5% penalty regardless of ratio

  **Impact Analysis (ETHUSD example):**
  - Fill-time ratio: 21min/84min = 0.25 -> 12% penalty (was 0%)
  - Combined with existing omega conflict penalty (~15%): total ~25% degradation
  - Trade at 83% base -> ~62% final (borderline) instead of 71% (comfortable pass)

  **SSOT Compliance:**
  - SessionAdvisor remains sole authority for time-based confidence adjustments
  - No new domain created; existing infrastructure enhanced
  - Worst-case-wins principle preserved (one penalty per domain)

  **Files Modified:**
  - src/services/confidence-calculation-engine.ts (domain cap)
  - src/services/alpha-omega-orchestrator.ts (graduated ratio computation)

  ## Change 2: Notification Double-Play Fix

  **Problem:**
  Goal achievement events created duplicate notifications. When a goal was achieved:
  1. `modalQueueManager.createPendingModal()` created a countdown modal
  2. When shown, the modal triggered `modalNotificationBridge.captureDialog()` which
     inserted into `goal_notifications` AND dispatched a push notification
  3. THEN `notificationCoordinator.send()` was called immediately, creating a SECOND
     `goal_notifications` record AND a SECOND push notification

  Users received duplicate goal achievement notifications and duplicate push alerts.

  **Root Cause:**
  Two independent notification paths both fired for the same event:
  - Path A: Modal system (bridge) -> DB insert + push dispatch
  - Path B: Notification coordinator -> DB insert + push dispatch
  The coordinator call was labeled as "fallback" but executed unconditionally.

  **Fix:**
  Removed the duplicate `notificationCoordinator.send()` call from
  `processAchievement()` in goal-achievement-coordinator.ts. The modal notification
  bridge is the single source of truth for goal_achieved notifications during the
  countdown flow. The notification coordinator remains active for other notification
  types (goal_progress, session_timeout, trade continuation).

  **SSOT Compliance:**
  - Modal notification bridge is now the sole path for countdown goal_achieved notifications
  - Notification coordinator remains SSOT for non-modal notification types
  - No duplicate DB records or push dispatches for the same event

  **Files Modified:**
  - src/services/coordinators/goal-achievement-coordinator.ts (removed duplicate send)
*/

SELECT 'CCIP governance migration: session_advisor_enhancement_and_notification_dedup applied' AS status;
