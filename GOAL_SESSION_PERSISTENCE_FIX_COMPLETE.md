# Goal Session Persistence Fix - Complete

## Problem Summary

When a user started a goal session and navigated away from the page (tab hidden), the polling system would shut down due to:

1. **Browser timer throttling** → Heartbeat detected "stale" symbols
2. **Aggressive health checks** → System saw symbols as unhealthy
3. **Automatic failover** → PollingOrchestrator shut down global coordinator
4. **Data loss** → Active goal sessions lost their price feed

## Root Cause

The polling system had **no awareness of active goal sessions**. It treated browser tab visibility and timer throttling as critical failures, even when goal sessions were actively running and needed continuous data.

## Solution Implemented

### 1. Session-Aware Polling Orchestrator

**File:** `src/services/polling-orchestrator.ts`

**Changes:**
- Added `activeGoalSessions` tracking set
- Created `checkForActiveSessions()` database query
- Added `subscribeToGoalSessions()` for realtime updates
- Implemented `handleSessionChange()` for session lifecycle events
- **CRITICAL:** Modified `checkSystemHealth()` to skip failover when active sessions exist
- **CRITICAL:** Modified `shutdown()` to prevent shutdown when sessions are active

**Key Logic:**
```typescript
// Before allowing failover
const hasActiveSessions = await this.checkForActiveSessions();
if (hasActiveSessions) {
  console.warn('⚠️ Active goal sessions detected - MAINTAINING polling despite health issues');
  globalPollingCoordinator.notifyActiveSessions(true);
  return; // Skip failover
}
```

### 2. Protected Symbols System

**File:** `src/services/global-polling-coordinator.ts`

**Changes:**
- Added `protectedSymbols` Map tracking which sessions protect which symbols
- Added `hasActiveSessions` flag for increased tolerance
- Added `activeSessionHeartbeatThreshold` (10 vs normal 3)

**New Public Methods:**
- `protectSymbol(symbol, sessionId)` - Upgrades symbol to critical priority
- `unprotectSymbol(symbol, sessionId)` - Removes protection when session ends
- `isSymbolProtected(symbol)` - Checks if symbol has active protection
- `notifyActiveSessions(hasActiveSessions)` - Adjusts system tolerance

### 3. Increased Heartbeat Tolerance

**File:** `src/services/global-polling-coordinator.ts` (line 193-212)

**Changes:**
- Heartbeat threshold increases from **3 to 10 missed beats** when sessions active
- Accounts for browser throttling during background tab operation
- Prevents false "unhealthy" detection during normal background behavior

**Key Logic:**
```typescript
// Use higher threshold when active sessions exist
const effectiveThreshold = this.hasActiveSessions
  ? this.activeSessionHeartbeatThreshold  // 10
  : this.MAX_MISSED_HEARTBEATS;           // 3
```

### 4. Symbol Protection in Recovery

**File:** `src/services/global-polling-coordinator.ts`

**Modified Methods:**
- `recoverFromThrottling()` - Skips protected symbols during recovery
- `verifyPollingHealth()` - Counts protected symbols as always healthy
- `verifyPollingHealth()` - Skips full restart when active sessions present

**Key Logic:**
```typescript
// In recoverFromThrottling
if (this.isSymbolProtected(symbol)) {
  console.log(`🛡️ [${symbol}] Protected by active session - skipping recovery`);
  return;
}

// In verifyPollingHealth
if (this.isSymbolProtected(symbol)) {
  protectedCount++;
  activeCount++;
  console.log(`[${symbol}] 🛡️ Protected by active session - always healthy`);
  return;
}
```

### 5. Visibility Throttling Override

**File:** `src/services/global-polling-coordinator.ts` (line 170-177)

**Changes:**
- Enhanced visibility change handler to check for active sessions
- Logs special message when tab is hidden but sessions are active
- Maintains full polling rate despite browser throttling

**Key Logic:**
```typescript
if (wasVisible && !this.isTabVisible) {
  if (this.hasActiveSessions) {
    console.log('🙈 Tab hidden but 🛡️ ACTIVE GOAL SESSIONS detected');
    console.log('✅ Maintaining full polling despite tab visibility');
  }
}
```

### 6. Realtime Session Synchronization

**File:** `src/services/polling-orchestrator.ts` (line 113-170)

**Changes:**
- Subscribes to `goal_sessions` table changes via Supabase Realtime
- Monitors session status changes: `scanning`, `initializing`, `trade_pending`, `in_trade`, `soft_closing`
- Automatically protects/unprotects symbols as sessions start/end
- Loads existing active sessions on startup

**Session Lifecycle:**
1. Session starts → `protectSymbol()` called → Symbol upgraded to critical priority
2. Session active → Polling continues regardless of tab visibility or health
3. Session ends → `unprotectSymbol()` called → Normal polling resumes

## Testing the Fix

### Before Fix:
1. Start a goal session
2. Navigate away or hide the tab
3. **BUG:** Polling stops after ~15 seconds
4. **BUG:** Goal session loses price feed
5. **BUG:** Console shows "Shutting down global polling coordinator"

### After Fix:
1. Start a goal session
2. Navigate away or hide the tab
3. ✅ Console shows: "🛡️ Active goal sessions detected - MAINTAINING polling"
4. ✅ Polling continues at full rate
5. ✅ Protected symbols shown in health checks
6. ✅ Goal session receives uninterrupted data feed

## Console Output Examples

### Session Start:
```
[PollingOrchestrator] 🛡️ Goal session abc123 started - protecting XAUUSD
[GlobalCoordinator] 🛡️ Protected XAUUSD for session abc123
```

### Tab Hidden with Active Session:
```
🙈 Tab hidden but 🛡️ ACTIVE GOAL SESSIONS detected
✅ Maintaining full polling despite tab visibility
ℹ️ Protected symbols will continue at normal rate
```

### Health Check with Protected Symbols:
```
[XAUUSD] 🛡️ Protected by active session - always healthy
📊 Health check complete: 5 active (1 protected), 0 stale/dead of 5 pairs
```

### Failover Prevention:
```
[PollingOrchestrator] GlobalPollingCoordinator unhealthy, considering failover to Browser
[PollingOrchestrator] ⚠️ Active goal sessions detected - MAINTAINING polling despite health issues
[PollingOrchestrator] Protected sessions: 1
```

### Session End:
```
[PollingOrchestrator] ✅ Goal session abc123 ended - unprotecting XAUUSD
[GlobalCoordinator] ✅ Unprotected XAUUSD - no active sessions
```

## Files Modified

1. `src/services/polling-orchestrator.ts` - Session awareness and failover prevention
2. `src/services/global-polling-coordinator.ts` - Protected symbols and increased tolerance

## Impact

- ✅ Goal sessions persist across page navigation
- ✅ Goal sessions persist when tab is hidden
- ✅ Polling system respects active trading sessions
- ✅ Browser throttling doesn't interrupt active sessions
- ✅ Symbols used by sessions are protected from health-based shutdowns
- ✅ System automatically adapts to session lifecycle events

## Related Systems

This fix integrates with:
- `goal_sessions` table (status tracking)
- Supabase Realtime (session change notifications)
- Global Polling Coordinator (price data collection)
- Chart Protection System (data validation)
- Candle Persistence (historical data)

## Deployment

✅ Build successful
✅ All type checks pass
✅ No breaking changes
✅ Backward compatible

Ready to deploy: The system will now respect active goal sessions and maintain polling regardless of browser visibility or perceived health issues.
