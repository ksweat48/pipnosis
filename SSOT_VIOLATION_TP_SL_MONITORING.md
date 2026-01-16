# CRITICAL: SSOT VIOLATION IN TP/SL MONITORING

**Date:** 2026-01-16
**Severity:** Architecture P0
**Status:** ❌ VIOLATION CONFIRMED

---

## Executive Summary

The P0 fix for TP/SL not closing trades was deployed successfully and works. However, it **violates SSOT principles** by adding a FOURTH implementation of TP/SL monitoring logic instead of establishing a single authoritative source.

---

## The SSOT Violation

### Current State: 4 Implementations

**Responsibility:** "Check if TP/SL is hit and close the trade"

**Location 1: Database Trigger** (Fixed today)
- File: `supabase/migrations/emergency_fix_tp1_tp2_trigger_not_closing.sql`
- Trigger: `check_and_close_positions_on_price_update()`
- Executes: On every `realtime_prices` INSERT
- Calls: `close_goal_session_trade()` function
- Logic: Checks SL, TP2, TP1, legacy TP

**Location 2: Browser Realtime Monitor**
- File: `src/services/realtime-sltp-monitor.ts`
- Class: `RealtimeSLTPMonitor`
- Executes: Subscribes to `realtime_prices` via Realtime
- Calls: `tradeClosureCoordinator.closeTrade()`
- Logic: Checks SL, TP1 (partial 70%), TP2 (remaining 30%)
- Comment: "CRITICAL: This is a backup/redundant system alongside position-monitor"

**Location 3: Browser Polling Monitor**
- File: `src/services/position-monitor.ts`
- Class: `PositionMonitorService`
- Executes: Polls every 250ms (critical) / 1000ms (normal)
- Calls: `tradeClosureCoordinator.closeTrade()`
- Logic: Checks SL/TP status
- Comment: "High-frequency monitoring enabled: Critical=250ms, Normal=1000ms"

**Location 4: Server Autonomous Monitor**
- File: `netlify/functions/autonomous-position-monitor.ts`
- Type: Netlify scheduled function
- Executes: Every 5 seconds server-side
- Calls: Database closure functions
- Logic: Checks SL, TP, TP1, TP2
- Comment: "SSOT Authority for Position SL/TP/TP1/TP2 Monitoring"

---

## Why This Violates SSOT

### SSOT Principle
> "Every responsibility must have one authoritative owner"

### Current Problem
If the TP/SL checking logic has a bug, it must be fixed in **FOUR places**:
1. Database trigger SQL
2. Browser realtime monitor TypeScript
3. Browser polling monitor TypeScript
4. Server function TypeScript

### Example
Today's bug: TP1/TP2 not closing trades
- Fixed in: Database trigger ✅
- Also broken in: Browser monitors (still only check old `take_profit` column?) ❓
- Also broken in: Server monitor (also needs TP1/TP2 logic?) ❓

This is exactly the problem SSOT prevents!

---

## Conflicting Authority Claims

**Database Trigger says:**
- "EMERGENCY: If TP2 already hit but trade still open, close immediately"
- Implies: Database is authority

**Server Function says:**
- "SSOT Authority for Position SL/TP/TP1/TP2 Monitoring"
- "CRITICAL: This is the PRIMARY position monitoring system"
- Implies: Server function is authority

**Browser Realtime Monitor says:**
- "CRITICAL: This is a backup/redundant system alongside position-monitor"
- Implies: Browser is backup, but still implements full logic

**Result:** No clear authority. Four systems racing to close the same trade.

---

## Race Conditions

With 4 systems checking TP/SL:
1. Database trigger fires on price insert
2. Browser realtime receives same price ~50ms later
3. Browser polling checks 250ms later
4. Server function checks within 5 seconds

All four might try to close the same trade simultaneously, leading to:
- Duplicate close attempts
- Database deadlocks
- Conflicting PnL calculations
- User confusion (multiple notifications?)

---

## The SSOT Solution

### Option 1: Database Trigger as SSOT (Recommended)

**Single Authority:** Database trigger
- Pro: Guaranteed to see every price update
- Pro: Closes trades even if all clients offline
- Pro: Sub-second response time
- Pro: Already implemented and working

**All Others Become:**
- Browser monitors: Display-only, show status from database
- Server function: Removed or becomes "stale trade cleanup" only

**Changes Required:**
1. Remove TP/SL checking logic from `realtime-sltp-monitor.ts`
2. Remove TP/SL checking logic from `position-monitor.ts`
3. Remove TP/SL checking logic from `autonomous-position-monitor.ts`
4. All monitors subscribe to `goal_session_trades` changes
5. All monitors display trade status (already closed by trigger)

---

### Option 2: Server Function as SSOT

**Single Authority:** Server scheduled function
- Pro: Centralized, guaranteed execution
- Pro: No client-side dependencies
- Con: 5-second polling delay (vs trigger's instant)
- Con: Higher infrastructure cost

**All Others Become:**
- Database trigger: Removed completely
- Browser monitors: Display-only

**Changes Required:**
1. Remove database trigger entirely
2. Remove TP/SL logic from browser monitors
3. Enhance server function reliability
4. Accept 5-second delay in closures

---

### Option 3: Browser Coordinator as SSOT (Not Recommended)

**Single Authority:** Browser coordinator
- Pro: User sees closure happen in real-time
- Con: Doesn't work if browser offline
- Con: Capital at risk if page closed

**Not recommended** - positions must close regardless of browser state.

---

## Immediate Risk

**Current System Works But:**
- Four implementations create maintenance nightmare
- If one implementation has different logic, unpredictable behavior
- Today's fix updated database trigger, but did other 3 get updated?
- Next bug might be in browser monitors, requiring 3 more fixes

**Incident Today:** Database trigger didn't check TP1/TP2
- Question: Do browser monitors check TP1/TP2 correctly?
- Question: Does server function check TP1/TP2 correctly?
- If not, we have 3 more bugs to fix in 3 different places!

---

## Recommended Action Plan

### Phase 1: Audit (Immediate)
1. Check if browser monitors handle TP1/TP2 correctly
2. Check if server function handles TP1/TP2 correctly
3. Compare all 4 implementations for logic differences

### Phase 2: Consolidate (Next Sprint)
1. **Designate SSOT:** Database trigger (fastest, most reliable)
2. **Refactor browser monitors:**
   - Subscribe to `goal_session_trades` table changes
   - Display trade status from database
   - Remove all closure logic
3. **Refactor server function:**
   - Change from "primary monitor" to "stuck trade cleanup"
   - Only close trades missed by trigger (backup only)
   - Log when trigger failed

### Phase 3: Verify (Post-Deploy)
1. Monitor that only database trigger closes trades
2. Verify browser monitors are view-only
3. Confirm server function only catches edge cases

---

## Long-Term Architecture

```
┌─────────────────────────────────────────┐
│     SSOT: Database Trigger              │
│  check_and_close_positions_on_price()   │
│                                         │
│  - Checks SL/TP1/TP2 on every price     │
│  - Calls close_goal_session_trade()     │
│  - Updates database status              │
│  - Sends notifications                  │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼──────┐       ┌────────▼────────┐
│   Browser    │       │  Server Backup  │
│   Monitors   │       │   (Edge Cases)  │
│              │       │                 │
│  - Subscribe │       │  - Cleanup only │
│  - Display   │       │  - Log failures │
│  - No logic  │       │  - Alert admins │
└──────────────┘       └─────────────────┘
```

---

## Decision Required

**Question:** Which system should be the SSOT for TP/SL monitoring?

**Recommendation:** Database trigger
- Already working
- Fastest response time
- Most reliable
- Platform-independent

**Action:** Remove duplicate logic from other 3 systems

---

## Sign-Off

**SSOT Violation:** Confirmed ❌
**Production Impact:** None (all 4 systems work)
**Maintenance Risk:** High (4x code duplication)
**Architectural Debt:** Critical

**Next Steps:** Architecture team decision required
