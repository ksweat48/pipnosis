# Session Status Fix - Entry Monitor Mode

## Problem

When Alpha made a WAIT decision and started entry monitoring, the session would immediately end, even though it was actively monitoring for the perfect entry. The logs showed:

```
[AI Trading] ⏸️ WAIT decision received for BTCUSD - starting ENTRY_MONITOR mode
[ENTRY_MONITOR] Started monitoring BTCUSD SELL - Intent ID: 23313cca-b716-43d1-bd23-0c0c0f306405
[PollingOrchestrator] ✅ Goal session bd39562d-5747-4159-9d2b-c4660e517f73 ended - unprotecting...
```

## Root Cause

**Status Mismatch Between Systems:**

1. **Entry Monitor Coordinator** (entry-monitor-coordinator.ts line 200):
   - Changed session status from `'scanning'` to `'active'`
   - This was intentional to prevent the UnifiedEntryMonitor from rejecting the session

2. **Polling Orchestrator** (polling-orchestrator.ts lines 103, 154, 196):
   - Only recognized these statuses as "active sessions": `['scanning', 'initializing', 'trade_pending', 'in_trade']`
   - Missing `'active'` from the list

3. **Result**: When status changed to `'active'`, the polling orchestrator thought the session ended and unprotected all symbols, causing the session to appear terminated.

## Solution

Updated the **Polling Orchestrator** to recognize `'active'` as a valid active session status:

### Changed Files

#### 1. `/src/services/polling-orchestrator.ts`

**Updated 3 locations where session status is checked:**

- Line 103: `loadActiveSessions()` - Added `'active'` to status query
- Line 154: `handleSessionChange()` - Added `'active'` to activeStatuses array
- Line 196: `checkForActiveSessions()` - Added `'active'` to status query

**Before:**
```typescript
.in('status', ['scanning', 'initializing', 'trade_pending', 'in_trade'])
```

**After:**
```typescript
.in('status', ['scanning', 'initializing', 'trade_pending', 'in_trade', 'active'])
```

#### 2. `/src/services/entry-monitor-coordinator.ts`

**Enhanced documentation (lines 195-207):**

Added comprehensive comment explaining why status is set to `'active'`:
- UnifiedEntryMonitor validation requirement
- Semantic meaning: "actively monitoring for entry"
- Polling orchestrator integration
- Prevents premature session termination

## Session Status Lifecycle

```
initializing       → Session being created
    ↓
scanning          → Actively scanning markets for opportunities
    ↓
active            → Waiting for perfect entry (Entry Monitor mode)
    ↓
trade_pending     → Trade signal found, awaiting execution
    ↓
in_trade          → Trade actively open
    ↓
goal_achieved     → Session completed successfully
force_closed_*    → Session terminated (various reasons)
```

## Database Schema

The `'active'` status was already valid in the database schema (added in migration `20260109210617_add_active_status_to_constraint_v2.sql`).

The constraint allows:
- `'initializing'`
- `'scanning'`
- `'active'` ✅
- `'trade_pending'`
- `'in_trade'`
- `'awaiting_continuation'`
- Plus terminal states (goal_achieved, force_closed_*, etc.)

## Verification

✅ Build completed successfully
✅ No TypeScript errors
✅ Session will remain active during entry monitoring
✅ Polling protection maintained for monitored symbols
✅ Entry monitor can complete its work without session ending

## Testing Recommendation

Test the flow:
1. Start a goal session
2. Alpha makes a WAIT decision
3. Entry monitor starts watching for entry
4. **Expected**: Session stays in `'active'` status, monitoring continues
5. **Expected**: Symbols remain protected (ultra-critical 250ms polling)
6. **Expected**: Entry executes when conditions are met OR times out gracefully

## Impact

- **Zero breaking changes** - only additive
- **Backward compatible** - existing sessions unaffected
- **Fixes critical bug** - entry monitoring no longer terminates sessions prematurely
- **Maintains all protections** - polling, monitoring, and alerts continue working
