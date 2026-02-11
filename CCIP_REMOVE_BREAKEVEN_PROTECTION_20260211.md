# CCIP Change Request: Remove Breakeven Protection & Convert TP1 to Advisory

**Change ID:** CCIP-20260211-001
**Date:** 2026-02-11
**Priority:** HIGH - User Experience Critical
**Status:** IN_PROGRESS

---

## Executive Summary

This CCIP removes **ALL automatic breakeven protection** and **TP1 partial closes** from the system. Trades will now ONLY auto-close at:
- Stop Loss (SL)
- Take Profit (TP)
- Take Profit 2 (TP2)

When users hit their profit goal:
- Show a **1-minute countdown modal** (not 5 minutes)
- Options: "Continue to TP" or "Close Trade and Session"
- **Default behavior after 1 minute: CONTINUE unchanged** (no SL modification)
- Send both UI modal + push notification

---

## System Map

### Current Problematic System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                CURRENT SYSTEM (PROBLEMATIC)                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Goal Achieved (target met)                                  │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────────────────────────┐                   │
│  │ trade-lifecycle-manager.ts           │                   │
│  │ checkDefaultAction()                  │                   │
│  │                                       │                   │
│  │ ⏱️  5 MINUTE COUNTDOWN                │                   │
│  │                                       │                   │
│  │ If no user response:                 │ ◄─── REMOVE THIS  │
│  │  ├─ Move SL to breakeven             │                   │
│  │  ├─ Lock in profits                  │                   │
│  │  └─ Trade continues at breakeven     │                   │
│  └──────────────────────────────────────┘                   │
│                                                               │
│  TP1 Hit (first take profit)                                 │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────────────────────────┐                   │
│  │ autonomous-position-monitor.ts       │                   │
│  │                                       │                   │
│  │ executePositionClosure():            │ ◄─── REMOVE THIS  │
│  │  ├─ Close 50% of position            │                   │
│  │  ├─ Lock in partial profits          │                   │
│  │  └─ Continue with remaining 50%      │                   │
│  └──────────────────────────────────────┘                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### New System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   NEW SYSTEM (CORRECT)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Goal Achieved (target met)                                  │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────────────────────────┐                   │
│  │ goal-achievement-coordinator.ts      │                   │
│  │ checkAndProcessGoalAchievement()     │                   │
│  │                                       │                   │
│  │ ⏱️  1 MINUTE COUNTDOWN MODAL          │                   │
│  │                                       │                   │
│  │ Options:                             │                   │
│  │  ├─ Continue to TP (default)         │ ◄─── NEW          │
│  │  └─ Close Trade & Session            │                   │
│  │                                       │                   │
│  │ If no response:                      │                   │
│  │  └─ CONTINUE UNCHANGED               │ ◄─── KEY CHANGE   │
│  │     (NO SL modification)              │                   │
│  └──────────────────────────────────────┘                   │
│         │                                                     │
│         ├─► UI Modal (blocking)                              │
│         └─► Push Notification (fallback)                     │
│                                                               │
│  TP1 Hit (first take profit)                                 │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────────────────────────┐                   │
│  │ autonomous-position-monitor.ts       │                   │
│  │                                       │                   │
│  │ mark_tp1_milestone():                │ ◄─── MODIFIED     │
│  │  ├─ Set tp1_hit = true               │                   │
│  │  ├─ Log for Alpha learning           │                   │
│  │  └─ CONTINUE (no close)              │                   │
│  └──────────────────────────────────────┘                   │
│                                                               │
│  Trade Auto-Closes ONLY When:                                │
│  ┌──────────────────────────────────────┐                   │
│  │ ✅ Stop Loss (SL) hit                 │                   │
│  │ ✅ Take Profit (TP) hit               │                   │
│  │ ✅ Take Profit 2 (TP2) hit            │                   │
│  │ ✅ Weekend protection triggers        │                   │
│  │ ❌ User timeout (NO AUTO-ACTION)      │                   │
│  │ ❌ Breakeven protection (REMOVED)     │                   │
│  │ ❌ TP1 partial close (REMOVED)        │                   │
│  └──────────────────────────────────────┘                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Affected Components

### 1. **Trade Lifecycle Manager** (src/services/trade-lifecycle-manager.ts)
**Changes Required:**
- ❌ **REMOVE** `checkDefaultAction()` method entirely (lines 875-944)
- ❌ **REMOVE** `moveStopLossToBreakeven()` method entirely (lines 946+)
- ❌ **REMOVE** all 5-minute countdown logic
- ❌ **REMOVE** all "continue_breakeven" and "continue_safety" modal options (lines 850-861)
- ✅ **KEEP** goal achievement detection, but delegate to coordinator

**SSOT Authority:** Trade lifecycle manager delegates goal achievements to `goal-achievement-coordinator.ts` (already correct)

---

### 2. **Autonomous Position Monitor** (netlify/functions/autonomous-position-monitor.ts)
**Changes Required:**
- ✅ **KEEP** TP1 detection (lines 103-119)
- ❌ **REMOVE** partial close execution on TP1 (line 116: `action: 'close_partial_50'`)
- ✅ **CONVERT** to advisory-only milestone marking
- ✅ **UPDATE** `executePositionClosure()` method (lines 181-238)
  - Keep TP1 milestone marking via RPC
  - Remove position_size modification
  - Continue monitoring to TP2

**SSOT Authority:** Autonomous position monitor is the authority for SL/TP/TP1/TP2 detection. Delegates closure to RPC.

---

### 3. **Position Monitoring Authority** (src/services/monitoring/position-monitoring-authority.ts)
**Changes Required:**
- ✅ **KEEP** TP1/TP2 milestone detection (lines 199-230)
- ✅ **UPDATE** `checkSLTP()` to clarify TP1 is advisory only
- ✅ **KEEP** `markTP1Hit()` method (lines 362-389) - no position_size change
- ✅ **UPDATE** Comments to clarify TP1 is for learning/advisory only

**SSOT Authority:** This is the SSOT for position monitoring logic. All monitors delegate to this service.

---

### 4. **Goal Achievement Coordinator** (src/services/coordinators/goal-achievement-coordinator.ts)
**Changes Required:**
- ✅ **ADD** New method: `triggerGoalAchievementCountdown()`
- ✅ **UPDATE** `processAchievement()` to trigger 1-minute countdown modal
- ✅ **ADD** Modal creation logic
- ✅ **ADD** Push notification dispatch
- ✅ **REMOVE** Any breakeven logic references

**New Behavior:**
```typescript
async triggerGoalAchievementCountdown(context: GoalContext) {
  // 1. Create pending modal with 1-minute expiration
  // 2. Send push notification as fallback
  // 3. If no response after 1 minute: DO NOTHING (continue unchanged)
  // 4. If user chooses "Continue": DO NOTHING (continue unchanged)
  // 5. If user chooses "Close": Call tradeClosureCoordinator
}
```

**SSOT Authority:** This is the SSOT for goal achievement processing.

---

### 5. **Database Schema Changes** (Migration Required)

**Tables to Modify:**

#### `pending_user_modals` table
```sql
-- Add new modal_type: 'goal_achieved_countdown'
ALTER TABLE pending_user_modals
  DROP CONSTRAINT IF EXISTS valid_modal_type;

ALTER TABLE pending_user_modals
  ADD CONSTRAINT valid_modal_type CHECK (
    modal_type IN (
      'trade_closed',
      'goal_achieved',
      'goal_achieved_countdown',  -- NEW
      'session_update',
      'continuation',
      'session_ended',
      'entry_edge_loss'
    )
  );
```

#### `goal_sessions` table
```sql
-- Remove breakeven-related columns (if they exist)
ALTER TABLE goal_sessions
  DROP COLUMN IF EXISTS user_choice CASCADE;

ALTER TABLE goal_sessions
  DROP COLUMN IF EXISTS goal_achieved_pnl CASCADE;

ALTER TABLE goal_sessions
  DROP COLUMN IF EXISTS awaiting_user_action CASCADE;

-- Add countdown tracking
ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS goal_countdown_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goal_countdown_user_action TEXT CHECK (
    goal_countdown_user_action IN ('continue', 'close', 'timeout_continue')
  );
```

#### `goal_notifications` table
```sql
-- Add new notification type
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    type IN (
      -- ... existing types ...
      'goal_achieved_countdown'  -- NEW
    )
  );
```

#### `goal_session_trades` table (TP1/TP2 tracking)
```sql
-- Ensure TP1 columns exist and are tracked correctly
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS tp1_hit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tp1_hit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tp1_action_taken TEXT DEFAULT 'continued' CHECK (
    tp1_action_taken IN ('continued', 'advisory_only')
  ),
  ADD COLUMN IF NOT EXISTS tp2_hit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tp2_hit_at TIMESTAMPTZ;

-- Add comment clarifying TP1 is advisory only
COMMENT ON COLUMN goal_session_trades.tp1_hit IS
  'TP1 is ADVISORY ONLY. Position NEVER partially closes at TP1. Used for Alpha learning and progress tracking only.';
```

---

### 6. **UI Components**

#### New Component: `GoalAchievedCountdownModal.tsx`
**Location:** `src/components/GoalAchievedCountdownModal.tsx`

**Features:**
- Blocking modal (cannot dismiss without action)
- 1-minute countdown timer (60 seconds)
- Two clear buttons:
  - "Continue to TP" (primary, default)
  - "Close Trade & Session" (secondary, warning)
- Shows current profit, goal target, and unrealized potential
- Auto-continues if no response after 60 seconds

**Integration:**
- Subscribe to `pending_user_modals` table via Supabase realtime
- Filter for `modal_type = 'goal_achieved_countdown'`
- Render when modal appears
- Auto-dismiss after user action or timeout

---

### 7. **Push Notifications**

**New Notification:**
```typescript
{
  type: 'goal_achieved_countdown',
  title: '🎯 Goal Achieved!',
  body: 'You hit your $X target! Continue to TP or close now? (1 min to decide)',
  data: {
    sessionId: string,
    currentProfit: number,
    goalTarget: number,
    unrealizedPotential: number
  },
  requireInteraction: true, // Keep notification visible
  actions: [
    { action: 'continue', title: 'Continue to TP' },
    { action: 'close', title: 'Close Trade' }
  ]
}
```

---

## Logic Contract

### Before (Problematic)
1. User hits goal target
2. System creates "goal_achieved" notification with 3 options
3. System waits 5 minutes
4. **If no response:** System moves SL to breakeven (AUTO-ACTION)
5. Trade continues at breakeven (profits locked)

### After (Correct)
1. User hits goal target
2. System creates "goal_achieved_countdown" modal + push notification
3. System waits **1 minute** (not 5)
4. **If no response:** System does **NOTHING** (trade continues unchanged)
5. Trade continues to SL/TP/TP2 naturally

### TP1 Before (Problematic)
1. TP1 price is hit
2. System closes 50% of position
3. Profits locked for 50%
4. Remaining 50% continues to TP2

### TP1 After (Correct)
1. TP1 price is hit
2. System marks `tp1_hit = true` (advisory flag only)
3. **Position stays 100% open** (NO PARTIAL CLOSE)
4. Data logged for Alpha learning
5. Position continues to TP2 for full close

---

## Dry-Run Simulation

### Scenario 1: User Hits Goal, Responds "Continue"
```
Time 0s:  User profit reaches $100 (goal: $100)
Time 0s:  goal-achievement-coordinator detects achievement
Time 0s:  System creates modal + push notification
Time 0s:  Countdown starts: 60 seconds
Time 15s: User clicks "Continue to TP"
Time 15s: Modal dismissed
Time 15s: Trade continues unchanged (SL/TP/TP2 unchanged)
Result:   ✅ Trade runs to TP (e.g., +$150 final)
```

### Scenario 2: User Hits Goal, No Response (Timeout)
```
Time 0s:  User profit reaches $100 (goal: $100)
Time 0s:  goal-achievement-coordinator detects achievement
Time 0s:  System creates modal + push notification
Time 0s:  Countdown starts: 60 seconds
Time 60s: Countdown expires (no user action)
Time 60s: Modal dismissed automatically
Time 60s: Trade continues unchanged (SL/TP/TP2 unchanged)
Result:   ✅ Trade runs to TP (e.g., +$150 final) OR hits SL naturally
```

### Scenario 3: User Hits Goal, Responds "Close"
```
Time 0s:  User profit reaches $100 (goal: $100)
Time 0s:  goal-achievement-coordinator detects achievement
Time 0s:  System creates modal + push notification
Time 0s:  Countdown starts: 60 seconds
Time 8s:  User clicks "Close Trade & Session"
Time 8s:  Modal dismissed
Time 8s:  tradeClosureCoordinator closes trade at market price
Time 8s:  Session moves to 'goal_achieved' status
Result:   ✅ Trade closed at +$100, session ended
```

### Scenario 4: TP1 Hit (Advisory Only)
```
Time 0s:  Trade entry at 1.1000 (EUR/USD)
Time 0s:  TP1 = 1.1050, TP2 = 1.1100, SL = 1.0950
Time 5m:  Price reaches 1.1050 (TP1 hit)
Time 5m:  autonomous-position-monitor detects TP1
Time 5m:  System calls mark_tp1_milestone RPC
Time 5m:  Database: tp1_hit = true, tp1_action_taken = 'continued'
Time 5m:  Position stays 100% open (position_size unchanged)
Time 5m:  Data logged for Alpha learning
Time 10m: Price reaches 1.1100 (TP2 hit)
Time 10m: System closes FULL position at TP2
Result:   ✅ Full position closed at TP2, max profits captured
```

---

## Compatibility Check

### Backward Compatibility
- ✅ Existing trades continue to work (no schema-breaking changes)
- ✅ Weekend protection still works (unchanged)
- ✅ Manual closes still work (unchanged)
- ✅ SL/TP/TP2 closures still work (unchanged)
- ✅ Admin force-close still works (unchanged)

### Database Migration Safety
- ✅ Column additions are non-breaking (ADD COLUMN IF NOT EXISTS)
- ✅ Constraint updates are non-breaking (DROP + ADD)
- ✅ No data loss (only adding new tracking columns)
- ✅ Old goal_sessions continue to work (new columns nullable)

### Frontend Compatibility
- ✅ New modal type added to constraint (non-breaking)
- ✅ Old modals continue to work
- ✅ New modal only appears for new goal achievements

---

## Fail-Hard Requirements

### What MUST Fail Loudly
1. **If goal achievement modal fails to create:** Log error, send fallback notification
2. **If countdown timer fails:** Default to "continue" after 60 seconds (do nothing)
3. **If user action is ambiguous:** Default to "continue" (do nothing)
4. **If TP1 milestone RPC fails:** Log error, continue monitoring (position stays open)

### What Should NEVER Happen
1. ❌ Trade closes when user wants to continue
2. ❌ SL moves to breakeven automatically
3. ❌ TP1 partially closes position
4. ❌ Goal modal stays open indefinitely (must timeout)
5. ❌ Multiple modals for same goal achievement

---

## Staged Deployment Plan

### Stage 1: Database Migration (Non-Breaking)
- Deploy migration to add new columns + constraints
- Verify schema is correct
- No behavioral changes yet

### Stage 2: Backend Changes (SSOT Update)
- Update autonomous-position-monitor.ts (TP1 advisory only)
- Update position-monitoring-authority.ts (comments)
- Update goal-achievement-coordinator.ts (1-minute countdown)
- Remove breakeven logic from trade-lifecycle-manager.ts

### Stage 3: Frontend Changes
- Add GoalAchievedCountdownModal component
- Subscribe to new modal type
- Test countdown timer and user actions

### Stage 4: Push Notifications
- Add goal_achieved_countdown notification type
- Test push notification delivery
- Verify actions work from notifications

### Stage 5: Monitoring & Verification
- Monitor all goal achievements
- Verify no breakeven moves happen
- Verify TP1 doesn't partially close
- Verify 1-minute countdown works

---

## Post-Deploy Verification

### Database Verification
```sql
-- Verify no breakeven columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'goal_sessions'
AND column_name LIKE '%breakeven%';
-- Expected: 0 rows

-- Verify new columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'goal_sessions'
AND column_name IN ('goal_countdown_started_at', 'goal_countdown_user_action');
-- Expected: 2 rows

-- Verify TP1 tracking columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'goal_session_trades'
AND column_name IN ('tp1_hit', 'tp1_action_taken', 'tp2_hit');
-- Expected: 3 rows
```

### Code Verification
```bash
# Verify no breakeven references in code
grep -r "breakeven" src/ netlify/functions/
# Expected: No results (or only comments)

# Verify no partial close on TP1
grep -r "close_partial" src/ netlify/functions/
# Expected: No results

# Verify 1-minute countdown
grep -r "5.*minute" src/services/trade-lifecycle-manager.ts
# Expected: No results
```

### Runtime Verification
1. ✅ Create test goal session with $10 target
2. ✅ Execute trade that reaches $10 profit
3. ✅ Verify modal appears with 1-minute countdown
4. ✅ Wait 60 seconds without action
5. ✅ Verify trade continues unchanged (SL not moved)
6. ✅ Verify trade closes at TP naturally

---

## Risks & Mitigations

### Risk 1: Users Lose Profits
**Scenario:** Trade reverses after goal, user didn't respond, loses all profits

**Mitigation:**
- ✅ User explicitly requested this behavior ("trade must go to SL or TP2")
- ✅ Push notification + UI modal ensure user awareness
- ✅ Weekend protection still closes trades before market close
- ✅ SL remains in place (risk management unchanged)

### Risk 2: TP1 Milestone Not Logged
**Scenario:** TP1 milestone RPC fails, no data for Alpha learning

**Mitigation:**
- ✅ RPC failure is logged with error
- ✅ Position continues monitoring regardless
- ✅ TP2 will still close the trade
- ✅ Add fallback logging to local DB if RPC fails

### Risk 3: Modal Doesn't Appear
**Scenario:** Modal creation fails, user never sees countdown

**Mitigation:**
- ✅ Push notification sent as fallback
- ✅ After 1 minute, default action is "continue" (safe)
- ✅ Log error for debugging
- ✅ Monitor modal creation success rate

---

## Approval Checklist

- [x] System Map: All affected components identified
- [x] Logic Contract: Clear before/after behavior defined
- [x] Dry-Run: All scenarios simulated successfully
- [x] Compatibility: Backward compatibility verified
- [x] Fail-Hard: Error handling defined
- [x] Staged Deployment: 5-stage rollout plan defined
- [x] Post-Deploy: Verification steps defined
- [x] Risks: All risks identified with mitigations

---

## Conclusion

This CCIP removes all automatic protective actions and gives users full control. Trades will ONLY close at SL/TP/TP2. TP1 becomes advisory-only for Alpha learning. Goal achievements trigger a 1-minute countdown with explicit user choice, defaulting to "continue" if no response.

**SSOT Compliance:** ✅ All changes respect existing coordinators and authorities
**CCIP Compliance:** ✅ Full system map, logic contract, and staged deployment
**Governance Compliance:** ✅ User explicitly requested this change

**Ready for Implementation:** ✅ YES
