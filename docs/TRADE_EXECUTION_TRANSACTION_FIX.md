# Trade Execution Transaction Order Fix

**Date**: 2026-01-12
**Severity**: CRITICAL
**Status**: FIXED

## Problem Summary

The system was marking entry intents as 'executed' BEFORE actually creating the trade in the database. When trade creation failed, this left the system in a broken state:

1. Intent marked as 'executed' (no trade exists)
2. Monitor state stuck in 'ENTRY_MONITOR_ACTIVE'
3. All scanning permanently blocked
4. User never notified of failure

## Root Cause

**Transaction Ordering Violation** in `unified-entry-monitor.ts` handleExecution():

```typescript
// OLD (BROKEN):
// Step 1: Mark intent executed FIRST
await EntryPlannerService.updateIntentStatus(intent.id, 'executed', ...);

// Step 2: Create trade SECOND (can fail!)
const result = await EntryExecutionCoordinator.executeFromIntent(...);
```

If Step 2 failed, Step 1 was already committed, creating an orphaned state.

## Fixes Applied

### 1. Reversed Transaction Order (PRIMARY FIX)

**File**: `src/services/unified-entry-monitor.ts`

```typescript
// NEW (FIXED):
// Step 1: Create trade FIRST
const result = await EntryExecutionCoordinator.executeFromIntent(intent.id, entryPrice);

if (!result.success) {
  // Trade failed - DO NOT mark executed, keep monitoring
  globalToastManager.show('Trade execution failed. Monitoring continues.', 'error');
  return; // Intent stays in 'monitoring' status
}

// Step 2: Mark executed ONLY after trade creation succeeds
await EntryPlannerService.updateIntentStatus(intent.id, 'executed', ...);

// Step 3: Reset monitor state to allow new scans
await supabase.rpc('transition_entry_monitor_state', {
  p_session_id: intent.session_id,
  p_new_state: 'DISCOVERY_SCANNING',
  ...
});
```

### 2. State Cleanup on Stop

**File**: `src/services/unified-entry-monitor.ts`

Added database state cleanup to `stopMonitoring()`:

```typescript
// CRITICAL: Reset monitor state when stopping for ANY reason
if (sessionId) {
  await supabase.rpc('transition_entry_monitor_state', {
    p_session_id: sessionId,
    p_new_state: 'DISCOVERY_SCANNING',
    p_locked_symbol: null,
    p_locked_direction: null
  });
}
```

This prevents orphaned states from ALL stop scenarios (executed, abandoned, expired, error).

### 3. Self-Healing Activation

**File**: `src/services/goal-session-live-engine.ts`

Changed autonomous engine to call `canScanNow()` instead of `getMonitorState()`:

```typescript
// OLD: Direct state check (no healing)
const monitorState = await entryMonitorCoordinator.getMonitorState(this.activeSession);
if (!monitorState.canScan) return;

// NEW: Calls self-healing first
const scanCheck = await entryMonitorCoordinator.canScanNow(this.activeSession);
if (!scanCheck.allowed) return;
```

The existing `validateAndHealState()` logic now runs on every scan, auto-fixing orphaned states.

### 4. Database Fail-Safe Function

**Migration**: `add_orphaned_state_failsafe.sql`

Created `heal_orphaned_monitor_states()` function that:
- Detects orphaned states (ENTRY_MONITOR_ACTIVE with no active intent, >2 minutes old)
- Auto-resets them to DISCOVERY_SCANNING
- Returns count and details of healed sessions
- Can be called manually or scheduled

```sql
SELECT * FROM heal_orphaned_monitor_states();
```

### 5. Enhanced Error Logging & User Notification

Added comprehensive error logging:
- Full stack traces on execution failures
- Intent ID, session ID, symbol, entry price logged
- User notification via toast when trade creation fails
- Clear console error messages with styling

## Prevention Measures

1. **Transaction Atomicity**: Trade creation must succeed before marking intent executed
2. **State Synchronization**: Monitor state always cleaned up when monitoring stops
3. **Self-Healing**: Automatic detection and correction of orphaned states
4. **Fail-Safe**: Database function to recover from any missed cleanup
5. **Error Transparency**: Users notified immediately when execution fails

## Testing Checklist

- [ ] Verify trade creation failure doesn't mark intent as executed
- [ ] Verify orphaned states auto-heal on next scan attempt
- [ ] Verify state is cleaned up when monitoring stops for any reason
- [ ] Verify user gets toast notification on trade execution failure
- [ ] Verify `heal_orphaned_monitor_states()` detects and fixes orphaned states
- [ ] Verify scanning resumes normally after execution (success or failure)

## Deployment Notes

1. All changes are backward compatible
2. No data migration required
3. Existing orphaned states will be healed on next scan attempt
4. Can manually heal existing orphaned states: `SELECT * FROM heal_orphaned_monitor_states();`

## Related Files

- `src/services/unified-entry-monitor.ts` (main fix)
- `src/services/goal-session-live-engine.ts` (self-healing activation)
- `supabase/migrations/add_orphaned_state_failsafe.sql` (fail-safe function)

## Impact

- **Reliability**: Eliminates permanent scan deadlock
- **User Experience**: Clear error notifications instead of silent failures
- **Data Integrity**: No more orphaned 'executed' intents without trades
- **Self-Healing**: System recovers automatically from any state inconsistency
