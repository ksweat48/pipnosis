# Goal Session Persistence - Quick Reference

## What Was Fixed

Goal sessions now **persist across page navigation and tab visibility changes**. The polling system will not shut down when active sessions are running.

## How It Works

### When You Start a Goal Session:

1. System detects session status = `scanning`
2. Symbol is automatically **protected** (🛡️)
3. Polling upgrades to **critical priority**
4. Heartbeat tolerance increases **3x** (15s → 50s)
5. Console shows: `🛡️ Protected XAUUSD for session abc123`

### When You Leave the Page:

**Before Fix:**
- ❌ Polling stops after 15 seconds
- ❌ Session loses data feed
- ❌ Console: "Shutting down global polling coordinator"

**After Fix:**
- ✅ Console: "🙈 Tab hidden but 🛡️ ACTIVE GOAL SESSIONS detected"
- ✅ Polling continues at full rate
- ✅ Protected symbols remain active
- ✅ Session receives uninterrupted data

### When You Return to Page:

- ✅ Polling still running
- ✅ Data feed never interrupted
- ✅ Session continues normally
- ✅ Console: "👁️ Tab became visible - verifying polling status"

### When Session Ends:

1. Session status changes to `completed` or `failed`
2. Symbol protection automatically removed
3. Polling returns to normal priority
4. Console: `✅ Unprotected XAUUSD - no active sessions`

## Key Console Messages

### Good Signs (Everything Working):
```
🛡️ Protected XAUUSD for session abc123
🙈 Tab hidden but 🛡️ ACTIVE GOAL SESSIONS detected
✅ Maintaining full polling despite tab visibility
🛡️ [XAUUSD] Protected by active session - always healthy
⚠️ Active goal sessions detected - MAINTAINING polling despite health issues
```

### Session Lifecycle:
```
🛡️ Goal session abc123 started - protecting XAUUSD
✅ Goal session abc123 ended - unprotecting XAUUSD
```

### Health Checks:
```
📊 Health check complete: 5 active (1 protected), 0 stale/dead of 5 pairs
```

## Protected Session Statuses

The system protects sessions with these statuses:
- `scanning` - Looking for trade opportunities
- `initializing` - Setting up session
- `trade_pending` - Trade about to execute
- `in_trade` - Trade currently open
- `soft_closing` - Closing trade gracefully

## Testing the Fix

1. **Start a goal session** (Quick $100 Today or any goal)
2. **Open console** and watch for protection message
3. **Navigate to another page** or minimize tab
4. **Wait 1-2 minutes**
5. **Return to page**
6. ✅ Check console - should show "Active goal sessions detected"
7. ✅ Verify polling never stopped
8. ✅ Check session is still running

## What Changed Internally

### PollingOrchestrator (`src/services/polling-orchestrator.ts`):
- Subscribes to `goal_sessions` table
- Checks for active sessions before failover
- Prevents shutdown when sessions active
- Tracks protected sessions in real-time

### GlobalPollingCoordinator (`src/services/global-polling-coordinator.ts`):
- Protects symbols used by active sessions
- Increases heartbeat tolerance (3→10 missed beats)
- Skips protected symbols during recovery
- Counts protected symbols as always healthy
- Maintains full polling when sessions active

## Troubleshooting

### If polling still stops:

1. **Check console for:**
   - `🛡️ Protected [symbol] for session [id]`
   - If missing → session not being detected

2. **Verify session status in database:**
   ```sql
   SELECT id, status, config->>'symbol'
   FROM goal_sessions
   WHERE status IN ('scanning', 'trade_pending', 'in_trade')
   ```

3. **Check PollingOrchestrator logs:**
   - Should show: "Active goal sessions detected"
   - If missing → subscription not working

4. **Verify GlobalCoordinator protection:**
   - Should show: "[symbol] 🛡️ Protected by active session"
   - If missing → protectSymbol() not called

### If you see "Shutting down global polling coordinator":

This should **never happen** when sessions are active. If it does:
1. Check that session status is in the protected list
2. Verify realtime subscription is connected
3. Check for errors in PollingOrchestrator initialization

## Related Documentation

- `GOAL_SESSION_PERSISTENCE_FIX_COMPLETE.md` - Full technical details
- `CHART_PROTECTION_SYSTEM_COMPLETE.md` - Data validation system
- `AUTONOMOUS_GOAL_SESSIONS_COMPLETE.md` - Goal session architecture
- `docs/CRITICAL_SYSTEMS.md` - System architecture overview
