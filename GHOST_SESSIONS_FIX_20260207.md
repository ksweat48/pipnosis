# Ghost Sessions Fix - February 7, 2026

## Problem Summary

Your console warnings were caused by **4 ghost sessions** - goal sessions stuck in "in_trade" status even though all their trades had closed days ago. The polling orchestrator detected these "active" sessions and maintained aggressive polling despite GlobalPollingCoordinator being unhealthy.

**Console Warnings You Saw:**
```
[PollingOrchestrator] ⚠️ Active goal sessions detected - MAINTAINING polling despite health issues
[PollingOrchestrator] Protected sessions: 4
```

---

## Ghost Sessions Found

All 4 sessions had **zero open trades** but were incorrectly marked as "in_trade":

| Session ID | User | Trade Symbol | Trade Closed | Status Before | Days Stuck |
|------------|------|--------------|--------------|---------------|------------|
| c4803d25... | User 1 | BTCUSD | Feb 6, 01:09 | in_trade | 1 day |
| 20eb4d24... | User 2 | USDJPY | Feb 4, 13:16 | in_trade | 3 days |
| 7cc8cd56... | User 3 | SPX500 | Feb 3, 14:43 | in_trade | 4 days |
| e0928984... | User 4 | USDJPY | Feb 5, 07:25 | in_trade | 2 days |

**Result:** All trades were closed (3 stop losses, 1 take profit), but sessions never transitioned to "completed" or "system_stopped".

---

## Root Cause

The system lacked automatic session completion when the last trade in a session closes. When a trade closes, the system:
1. ✅ Updates the trade status to "closed"
2. ✅ Records the close reason and P&L
3. ❌ **Never checked if this was the last open trade**
4. ❌ **Never auto-completed the parent session**

This created "zombie sessions" that the polling orchestrator considered active indefinitely.

---

## Fixes Applied

### 1. Cleaned Up Existing Ghost Sessions ✅

Marked all 4 ghost sessions as `system_stopped` with proper completion timestamps:

```sql
UPDATE goal_sessions
SET
  status = 'system_stopped',
  completed_at = (last trade close time),
  updated_at = NOW()
WHERE (ghost sessions)
```

**Result:** No more active sessions (`in_trade` count: 4 → 0)

### 2. Added Auto-Completion Trigger ✅

Created database trigger that automatically completes sessions when the last trade closes:

```sql
CREATE TRIGGER trigger_auto_complete_session_on_trade_close
  AFTER UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION auto_complete_session_on_trade_close();
```

**How it works:**
- Monitors all trade updates
- When a trade closes (status changes to 'closed')
- Checks if any other trades in that session are still open
- If zero open trades remain, marks session as 'system_stopped'
- Uses the trade's close timestamp as session completion time

### 3. Added Ghost Session Detection ✅

Created monitoring functions to detect and fix ghost sessions:

**Find Ghost Sessions:**
```sql
SELECT * FROM find_ghost_sessions();
```

Returns sessions stuck in 'in_trade' with no open trades, showing:
- Session ID and user
- Days stuck in ghost state
- Open vs closed trade counts

**Auto-Cleanup:**
```sql
SELECT * FROM cleanup_ghost_sessions();
```

Automatically fixes all ghost sessions and returns what was changed.

### 4. Performance Indexes ✅

Added indexes to speed up ghost session detection:
- `idx_goal_sessions_status_in_trade` - Fast lookup of active sessions
- `idx_goal_session_trades_status_open` - Fast counting of open trades per session

---

## Migration Applied

**File:** `ghost_session_prevention_and_cleanup.sql`
**Status:** ✅ Applied successfully
**Components:**
- Auto-completion trigger
- Ghost detection function
- Cleanup function
- Performance indexes

---

## Expected Behavior Now

### Normal Operation:
1. User starts a goal session → status = 'in_trade'
2. Trade opens → session stays 'in_trade'
3. **Trade closes → Trigger checks for remaining open trades**
4. **If last trade → Session auto-completes to 'system_stopped'**
5. Polling orchestrator sees zero active sessions
6. System can safely degrade when unhealthy

### Console Output After Fix:
```
[PollingOrchestrator] Protected sessions: 0
[PollingOrchestrator] Health Summary: active=0, degraded=0, critical=0, stopped=0
```

---

## Monitoring

### Check for Ghost Sessions:
```sql
-- Should always return empty unless there's a bug
SELECT * FROM find_ghost_sessions();
```

### Verify Session Cleanup Working:
```sql
-- After a trade closes, verify session completed
SELECT
  gs.status,
  gs.completed_at,
  COUNT(gst.id) FILTER (WHERE gst.status = 'open') as open_trades
FROM goal_sessions gs
LEFT JOIN goal_session_trades gst ON gst.goal_session_id = gs.id
WHERE gs.updated_at > NOW() - INTERVAL '1 hour'
GROUP BY gs.id, gs.status, gs.completed_at;
```

---

## Why This Matters

**Before Fix:**
- Ghost sessions prevented healthy system degradation
- Polling orchestrator maintained aggressive polling even when unhealthy
- GlobalPollingCoordinator couldn't enter failover mode
- Sessions leaked and accumulated over time

**After Fix:**
- Sessions automatically complete when trades finish
- Polling orchestrator can safely degrade when no real activity exists
- System resources preserved during low-activity periods
- Clean session lifecycle management

---

## Impact

✅ **Immediate:** Console warnings should stop (no more "Protected sessions: 4")
✅ **Ongoing:** All future sessions auto-complete when trades close
✅ **Safety:** Database trigger ensures consistency without app-layer logic
✅ **Monitoring:** Detection functions allow proactive ghost session identification

Your polling orchestrator is now free to degrade gracefully when truly unhealthy, instead of being held hostage by zombie sessions.
