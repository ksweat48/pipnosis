# CCIP P0 HOTFIX PLAN - CRITICAL FIXES REQUIRED BEFORE PRODUCTION

**Status**: 🔴 **BLOCKING** - Must implement before production deployment
**Timeline**: Week 1 (3 days)
**CCIP Impact**: Raises score from 67 → 75 (YELLOW → YELLOW-GREEN)

---

## P0-1: Fix Async Contract Violation (BLOCKING)
**Severity**: 🔴 **CRITICAL** - Will crash in production
**Effort**: 2-3 days
**Files Affected**: 23 callers of `entry-intent-classifier.classifyEntryIntent()`

### Problem
`EntryIntentClassifier.classifyEntryIntent()` was changed to **async** (returns Promise) but 23 callers still use **synchronous** pattern:

```typescript
// BROKEN (current code)
const intent = EntryIntentClassifier.classifyEntryIntent(decision, context, votes, vwap);
// intent is Promise<ClassifiedEntryIntent>, NOT ClassifiedEntryIntent
// Accessing intent.entry_zone_min will be undefined → crash
```

### Solution
Add `await` to all 23 call sites:

```typescript
// FIXED
const intent = await EntryIntentClassifier.classifyEntryIntent(
  decision,
  context,
  votes,
  vwap,
  microRegime
);
// Now intent is ClassifiedEntryIntent
```

### Files to Fix
1. `src/brains/coordinator-alpha.ts` (Alpha decision flow)
2. `src/services/goal-session-live-engine.ts` (Session scanning)
3. `src/services/entry-planner.ts` (Entry intent creation)
4. `src/services/entry-monitor-coordinator.ts` (Monitor orchestration)
5. **+ 19 other callers** (search codebase for `EntryIntentClassifier.classifyEntryIntent`)

### Verification
```bash
# Search for all callers
grep -r "EntryIntentClassifier.classifyEntryIntent" src/

# Each caller MUST have "await" before the call
# Verify: npm run build (no TypeScript errors)
# Test: Create entry intent in development
```

---

## P0-2: Add Database Query Timeouts (BLOCKING)
**Severity**: 🔴 **CRITICAL** - System hangs indefinitely
**Effort**: 1 day
**Files Affected**: All database queries (100+ locations)

### Problem
No timeouts on Supabase queries. If database connection pool exhausted or query slow:
- Query waits forever
- Session hangs
- User interface freezes
- Entire system can deadlock

### Solution
Add timeout wrapper for all queries:

```typescript
// Create in: src/lib/database-timeout-wrapper.ts

import { logger } from './logger';

export async function queryWithTimeout<T>(
  query: Promise<T>,
  operationName: string,
  timeoutMs: number = 5000
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => {
      logger.error(`[DatabaseTimeout] ${operationName} exceeded ${timeoutMs}ms`);
      reject(new Error(`Database timeout: ${operationName}`));
    }, timeoutMs)
  );

  try {
    return await Promise.race([query, timeoutPromise]);
  } catch (error) {
    if (error.message?.includes('timeout')) {
      // Return cached data or null
      logger.warn(`[DatabaseTimeout] Falling back to cached data for ${operationName}`);
      return null as T; // Caller must handle null
    }
    throw error;
  }
}
```

### Usage Example
```typescript
// BEFORE
const candles = await supabase
  .from('candles_5m')
  .select('*')
  .eq('symbol', symbol)
  .order('open_time', { ascending: false })
  .limit(200);

// AFTER
const { data: candles, error } = await queryWithTimeout(
  supabase
    .from('candles_5m')
    .select('*')
    .eq('symbol', symbol)
    .order('open_time', { ascending: false })
    .limit(200),
  'candle-data-service.getCandles',
  5000
);

if (error || !candles) {
  // Fallback to cached candles or throw
  return getCachedCandles(symbol);
}
```

### Priority Queries to Wrap (High → Low)
1. **candle-data-service.ts** (market data critical path)
2. **price-coordinator.ts** (execution critical path)
3. **position-monitor.ts** (S/L and T/P monitoring)
4. **entry-intent-monitor-mode.ts** (entry monitoring)
5. **professional-risk-manager.ts** (risk assessment)
6. **trade-execution-engine.ts** (trade execution)
7. All other database queries (batch update)

### Verification
```typescript
// Test: Simulate slow database
// In development, add artificial delay:
setTimeout(() => {
  // query
}, 10000); // 10 second delay

// Verify: Timeout triggers after 5 seconds
// Verify: System continues operating (doesn't hang)
```

---

## P0-3: Fix S/L and T/P Race Condition (BLOCKING)
**Severity**: 🔴 **CRITICAL** - Undefined execution behavior
**Effort**: 1 day
**Files Affected**: `src/services/position-monitor.ts`

### Problem
If price gaps through **both** S/L and T/P simultaneously:
- Both triggers activate
- Undefined which executes first
- Can cause duplicate closure attempts
- Inconsistent profit/loss accounting

### Solution
Add priority ordering: **S/L always wins**

```typescript
// In position-monitor.ts, around line 250-300

// Check S/L and T/P triggers
const slTriggered = direction === 'long'
  ? currentPrice <= stopLoss
  : currentPrice >= stopLoss;

const tpTriggered = direction === 'long'
  ? currentPrice >= takeProfit
  : currentPrice <= takeProfit;

// PRIORITY ORDERING: S/L always executes first
if (slTriggered && tpTriggered) {
  logger.warn(
    `[PositionMonitor] 🚨 BOTH S/L AND T/P TRIGGERED`,
    {
      positionId: positionId.substring(0, 8),
      currentPrice,
      stopLoss,
      takeProfit,
      direction,
      decision: 'Executing S/L (priority)'
    }
  );

  // Execute S/L only
  await closeTrade(positionId, 'STOP_LOSS', stopLoss, currentPrice);
  return; // Exit early, ignore T/P
}

// Normal single trigger handling
if (slTriggered) {
  await closeTrade(positionId, 'STOP_LOSS', stopLoss, currentPrice);
  return;
}

if (tpTriggered) {
  await closeTrade(positionId, 'TAKE_PROFIT', takeProfit, currentPrice);
  return;
}
```

### Rationale
S/L priority ensures:
- Risk management always wins (limit losses)
- Consistent accounting (loss recorded, not profit)
- Prevents optimistic accounting errors

### Verification
```typescript
// Unit test: Simulate gap scenario
it('should prioritize S/L when both triggered', async () => {
  const position = {
    entry_price: 1.1000,
    stop_loss: 1.0950,
    take_profit: 1.1050,
    direction: 'long'
  };

  // Price gaps from 1.1000 to 1.0930 (through both)
  const currentPrice = 1.0930;

  const result = await positionMonitor.checkPosition(position, currentPrice);

  expect(result.closeReason).toBe('STOP_LOSS');
  expect(result.closePrice).toBe(1.0950); // Executed at S/L, not T/P
});
```

---

## P0 Deployment Checklist

### Pre-Deployment (Development)
- [ ] Fix all 23 async contract violations
- [ ] Add database query timeout wrapper
- [ ] Fix S/L vs T/P race condition
- [ ] Run full test suite: `npm test`
- [ ] Run build: `npm run build`
- [ ] Manual testing:
  - [ ] Create goal session
  - [ ] Entry intent execution
  - [ ] Position S/L trigger
  - [ ] Position T/P trigger
  - [ ] Simulate database slowdown (timeout test)
  - [ ] Simulate price gap (S/L+T/P race test)

### Deployment Day
- [ ] Deploy to staging environment
- [ ] Run smoke tests (30 minutes)
- [ ] Deploy to production (10% traffic)
- [ ] Monitor for 2 hours:
  - [ ] No async crashes
  - [ ] No database timeouts
  - [ ] S/L and T/P execute correctly
- [ ] Increase to 50% traffic
- [ ] Monitor for 4 hours
- [ ] Increase to 100% traffic

### Post-Deployment (Day 1-7)
- [ ] Monitor error rate (target: < 0.1%)
- [ ] Monitor execution success rate (target: > 95%)
- [ ] Monitor database query latencies (target: < 1s p99)
- [ ] Monitor position closure accuracy (target: > 99.9%)
- [ ] No system hangs reported

### Rollback Criteria
**Rollback immediately if**:
- Error rate > 1%
- Execution success rate < 90%
- Any system hangs reported
- S/L or T/P misfire rate > 0.1%

---

## P0 Success Metrics

### Before P0 Fixes
- CCIP Score: **67/100 (YELLOW)**
- Risk Level: **MATERIAL** - Can crash in production
- Deployment: ⚠️ Caution required

### After P0 Fixes
- CCIP Score: **75/100 (YELLOW-GREEN)**
- Risk Level: **LOW** - Production-ready
- Deployment: ✅ Safe to deploy

### Expected Production Metrics
| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Uptime | > 99.5% | < 98% |
| Execution success rate | > 95% | < 90% |
| Position closure accuracy | > 99.9% | < 99% |
| Database query success | > 99.5% | < 98% |
| Error rate | < 0.1% | > 1% |

---

## P0 Completion Sign-Off

**Developer**: _______________ Date: ___________

**QA**: _______________ Date: ___________

**Deployment Engineer**: _______________ Date: ___________

---

**After P0 completion, proceed to P1 fixes (Week 2)**
See: `CCIP_CONSTITUTIONAL_AUDIT_REPORT.md` Phase 2 for next steps.
