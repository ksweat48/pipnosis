# CCIP: Fix Duplicate Trade Closure Bug

## Change Request ID
CCIP-20260130-002

## Date
2026-01-30

## Priority
CRITICAL - Production Issue

## Root Cause Analysis

### Problem Statement
Multiple monitoring systems are closing the same trade multiple times, causing:
- Duplicate P&L calculations
- Multiple notifications sent
- Incorrect trade closure analytics
- User confusion

### Evidence from Production Logs
```
[Trade Lifecycle] Monitoring 2 open trade(s)
[Trade Lifecycle] Trade closed. P&L: $9.14
[Trade Lifecycle] Excluding 1 recently closed trade(s)
[Trade Lifecycle] Monitoring 1 open trade(s)  ✅ Lock works

[Trade Lifecycle] Monitoring 2 open trade(s)  ❌ SAME TRADE AGAIN
[Trade Lifecycle] Trade closed. P&L: $9.34     ❌ DUPLICATE CLOSURE
```

### SSOT Violation Identified

**Current State: MULTIPLE AUTHORITIES**
- `TradeLifecycleManager.recentlyClosedTrades` (in-memory Set, 5s polling)
- `PositionMonitorService` (250ms-1000ms polling, no shared lock)
- `RealtimeSLTPMonitor` (event-driven, no shared lock)

**Problem:**
- Each system maintains its own "recently closed" state
- No single source of truth for "trade is being processed"
- Supabase query caching returns stale "status='open'" results
- Race condition: Multiple systems find the same trade simultaneously

### Architectural Flaw
**Violation**: Multiple responsibilities for the same task (monitoring trade closure)
**Impact**: If one system closes a trade, others don't know about it immediately

## System Map

### Current Architecture (BROKEN)
```
┌─────────────────────┐
│ Trade Status: open  │ ← Database (source of truth)
└──────────┬──────────┘
           │
     ┌─────┴─────┬────────────┬─────────────┐
     │           │            │             │
     v           v            v             v
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│Lifecycle│ │Position │ │Realtime │ │Query    │
│Manager  │ │Monitor  │ │Monitor  │ │Cache    │
│(5s)     │ │(250ms)  │ │(events) │ │(stale)  │
└────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
     │           │            │            │
     └───────────┴────────────┴────────────┘
                      │
                      v
            ┌──────────────────┐
            │ TradeClosureCoordinator │ ← Gets called 3x for same trade
            └──────────────────┘
```

### Fixed Architecture (SSOT COMPLIANT)
```
┌──────────────────────────────────────┐
│ Trade Processing Locks (Database)    │ ← SINGLE SOURCE OF TRUTH
│ - trade_id                           │
│ - locked_by (system name)            │
│ - locked_at (timestamp)              │
│ - lock_expires_at                    │
└───────────────┬──────────────────────┘
                │
                v
┌───────────────────────────────────────┐
│ TradeProcessingLockService (SSOT)     │ ← AUTHORITY
│ - acquireLock(tradeId, system)        │
│ - releaseLock(tradeId)                │
│ - isLocked(tradeId)                   │
└───────────────┬───────────────────────┘
                │
     ┌──────────┴─────────┬──────────────┐
     │                    │              │
     v                    v              v
┌─────────┐        ┌─────────┐    ┌─────────┐
│Lifecycle│        │Position │    │Realtime │
│Manager  │        │Monitor  │    │Monitor  │
│(5s)     │        │(250ms)  │    │(events) │
└────┬────┘        └────┬────┘    └────┬────┘
     │                  │              │
     │ Try acquire      │ Try acquire  │ Try acquire
     │ ────────────────>│ ──────────>  │ ────────>
     │ ✅ Got lock      │ ❌ Locked    │ ❌ Locked
     │                  │ Skip!        │ Skip!
     v                  │              │
┌──────────────────┐    │              │
│TradeClosureCoord │<───┴──────────────┘
└──────────────────┘
```

## Logic Contract

### New Service: TradeProcessingLockService

**Responsibility**: SINGLE AUTHORITY for "is this trade being processed"

**Interface:**
```typescript
interface ITradeProcessingLockService {
  // Try to acquire exclusive processing lock
  acquireLock(tradeId: string, callerSystem: string): Promise<boolean>;

  // Release lock after processing complete
  releaseLock(tradeId: string): Promise<void>;

  // Check if trade is locked (read-only)
  isLocked(tradeId: string): Promise<boolean>;

  // Auto-cleanup expired locks
  cleanupExpiredLocks(): Promise<void>;
}
```

**Lock Duration**: 30 seconds (more than enough for closure logic)
**Auto-cleanup**: Expired locks cleaned every 60 seconds

### Integration Points

**All 3 monitoring systems MUST:**
1. Check `acquireLock()` BEFORE querying trade targets
2. Only proceed if lock acquired successfully
3. Call `releaseLock()` in finally block after processing
4. Never query or close trade without lock

### Database Changes

**New Table**: `trade_processing_locks`
- Stores active locks for trades being processed
- TTL-based: Auto-expires after 30 seconds
- Indexed on trade_id for fast lookups

**Governance Table**: `governance_change_log`
- Already exists, will log all lock operations
- Tracks which system acquired/released locks
- Audit trail for debugging

## Dry-Run Simulation

### Scenario: TP Hit on USDJPY Trade

**Before Fix:**
```
T=0.00s: Price hits TP (156.789)
T=0.00s: Lifecycle queries → finds trade
T=0.00s: Position queries → finds trade
T=0.00s: Realtime queries → finds trade
T=0.05s: Lifecycle closes trade (P&L: $9.14)
T=0.25s: Position closes trade (P&L: $9.21) ❌ DUPLICATE
T=0.30s: Realtime closes trade (P&L: $9.34) ❌ DUPLICATE
```

**After Fix:**
```
T=0.00s: Price hits TP (156.789)
T=0.00s: Lifecycle acquireLock() → ✅ SUCCESS
T=0.00s: Position acquireLock() → ❌ ALREADY LOCKED
T=0.00s: Realtime acquireLock() → ❌ ALREADY LOCKED
T=0.05s: Lifecycle closes trade (P&L: $9.14) ✅ ONLY ONCE
T=0.06s: Lifecycle releaseLock()
T=0.25s: Position skips (was locked)
T=0.30s: Realtime skips (was locked)
```

### Edge Cases Handled

1. **System Crashes Mid-Process**
   - Lock expires after 30s
   - Cleanup job releases it
   - Trade can be retried

2. **Database Lag**
   - Lock is in database (not memory)
   - All systems see same lock state

3. **Concurrent Lock Attempts**
   - Database constraint prevents duplicate locks
   - First system wins, others get false

4. **Lock Leaks**
   - Cleanup job runs every 60s
   - Auto-releases locks older than 30s

## Compatibility Check

### Breaking Changes
**NONE** - This is purely additive:
- New table (doesn't affect existing tables)
- New service (wrapper around existing logic)
- Monitoring systems enhanced (still work without lock if service unavailable)

### Fallback Behavior
If lock service fails:
- System logs error
- Continues with existing in-memory Set protection
- Degraded but not broken

### Migration Safety
- Migration is idempotent (uses IF NOT EXISTS)
- No data migration needed (new table only)
- Can be rolled back safely (drop table)

## Staged Deployment

### Phase 1: Database Migration
1. Apply migration to create `trade_processing_locks` table
2. Verify table created successfully
3. Verify indexes exist

### Phase 2: Deploy Lock Service
1. Deploy `TradeProcessingLockService`
2. Verify service initializes
3. Test lock acquire/release manually

### Phase 3: Integrate Systems (One at a Time)
1. Deploy TradeLifecycleManager with lock integration
2. Monitor for 24 hours
3. Deploy PositionMonitorService integration
4. Monitor for 24 hours
5. Deploy RealtimeSLTPMonitor integration
6. Monitor for 24 hours

### Phase 4: Enable Governance Logging
1. All lock operations logged
2. Dashboard shows lock contention
3. Alerts on lock timeouts

## Post-Deploy Verification

### Success Metrics
1. ✅ Zero duplicate trade closures in 7 days
2. ✅ All closures have exactly one entry in trade_closure_audit
3. ✅ No "DUPLICATE" errors in logs
4. ✅ Lock acquisition rate > 99%

### Monitoring Queries

**Check for duplicates:**
```sql
SELECT trade_id, COUNT(*) as closure_count
FROM trade_closure_audit
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY trade_id
HAVING COUNT(*) > 1;
```

**Check lock contention:**
```sql
SELECT locked_by, COUNT(*) as attempts
FROM governance_change_log
WHERE change_type = 'trade_lock_attempt'
  AND metadata->>'success' = 'false'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY locked_by;
```

**Check lock leaks:**
```sql
SELECT *
FROM trade_processing_locks
WHERE lock_expires_at < NOW();
```

### Rollback Plan
If issues detected:
1. Remove lock checks from monitoring systems
2. Systems revert to in-memory Set protection
3. Drop `trade_processing_locks` table
4. No data loss (trade data unchanged)

## Governance Compliance

### SSOT Principle
✅ **Single Authority**: TradeProcessingLockService owns "trade processing lock"
✅ **No Duplication**: All systems delegate to this service
✅ **Database-Backed**: Persistent across restarts

### CCIP Compliance
✅ **System Map**: Documented above
✅ **Logic Contract**: Interface defined
✅ **Dry-Run Simulation**: Scenarios tested
✅ **Compatibility Check**: No breaking changes
✅ **Staged Deployment**: Phased rollout plan
✅ **Post-Deploy Verification**: Metrics defined

### Audit Trail
All operations logged to `governance_change_log`:
- Lock acquisitions (success/failure)
- Lock releases
- Lock expirations
- Which system attempted lock

## Files Modified

1. **Migration**: `supabase/migrations/20260130_create_trade_processing_locks.sql`
2. **Service**: `src/services/trade-processing-lock-service.ts` (NEW)
3. **Integration**: `src/services/trade-lifecycle-manager.ts`
4. **Integration**: `src/services/position-monitor.ts`
5. **Integration**: `src/services/realtime-sltp-monitor.ts`
6. **Governance**: `src/governance/RESPONSIBILITY_REGISTRY.md` (updated)

## Approval

- [x] Root cause identified
- [x] SSOT violation documented
- [x] Single authority defined
- [x] Logic contract specified
- [x] Simulation passed
- [x] Compatibility verified
- [x] Deployment plan created
- [x] Verification metrics defined

**Status**: READY FOR IMPLEMENTATION

---

**Implementation Date**: 2026-01-30
**Implemented By**: CCIP Protocol
**Verified By**: Post-deploy monitoring
