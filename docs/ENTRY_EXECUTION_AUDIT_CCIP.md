# Entry Execution System Audit - CCIP Compliant

**Date**: 2026-01-18
**Status**: P0 - Production System Analysis
**Scope**: Why "EXECUTE_READY" logs but execution doesn't happen

---

## CRITICAL FINDING: Pip Value System Confusion

### The Problem

There are **TWO different pip value systems** in the codebase:

1. **`symbol-registry.ts`** - Market data tick sizes
   - XAUUSD: `pipValue: 0.01` (minimum price increment)
   - Used by: Market data, zone calculations

2. **`currencyHelpers.ts`** - Position sizing reasoning pips
   - XAUUSD: `pipValue: 1.0` (reasoning pip: "20 pips" = 20 points)
   - Used by: Position sizing, risk calculations, **zone tolerance checks**

### The Bug

When `autonomous-entry-monitor.ts` checks if price is in zone:

```typescript
function checkPriceInZone(intent, price, tolerancePips) {
  const pipInfo = getCurrencyPipInfo(intent.symbol);  // Uses currencyHelpers.ts
  const tolerance = tolerancePips * pipInfo.pipValue; // XAUUSD: 2 pips × 1.0 = 2.0

  const effectiveMin = intent.entry_zone_min - tolerance;
  const effectiveMax = intent.entry_zone_max + tolerance;

  return price >= effectiveMin && price <= effectiveMax;
}
```

**BUT** if entry zones were calculated using `symbol-registry.ts` pip values:
- Zone tolerance for XAUUSD would be: 2 pips × 0.01 = 0.02 (100x smaller!)

This creates a **100x mismatch for metals** between:
- Zone calculation (expects 0.02 tolerance)
- Zone checking (uses 2.0 tolerance)

---

## User's Original Question

> **"Is this the same for forex and indices pairs?"**

**ANSWER**:
- ✅ Tolerance values (2, 5 pips) ARE scaled by asset type via `pipValue`
- ✅ Forex: 2 pips × 0.0001 = 0.0002 price units
- ✅ Indices: 2 pips × 1.0 = 2.0 points
- ✅ Crypto: 2 pips × 1.0 = 2.0 points
- ⚠️ **METALS (XAUUSD)**: Could be using WRONG pipValue (1.0 vs 0.01)

> **"Why were pip values reduced?"**

**ANSWER**:
- The previous values (30, 60 pips) were causing 5-pip zones to expand to 65-125 pips
- This made the system think price was "in zone" when it wasn't
- **BUT** if logs showed "EXECUTE_READY", the issue is NOT tolerance

> **"What does lowering the pips solve?"**

**ANSWER**:
- It fixes bloated zone expansion
- **BUT** it doesn't fix execution if "EXECUTE_READY" already logged
- The real issue is likely in `executeIntent()` function returning false

---

## Execution Flow Analysis

### Step 1: Check Conditions (Line 338)
```typescript
if (isInZoneWithPhase && eqsScore >= timeAdjustedThreshold) {
  // Conditions met, try to execute
  const executed = await executeIntent(intent, intent.current_price, eqsScore);
}
```

### Step 2: Execute Intent (Line 522-706)
**Possible failure points:**
1. **Line 528-543**: Intent fetch fails (RLS issue?)
2. **Line 635-645**: Trade insertion fails (constraint violation?)
3. **Line 650-662**: Intent status update fails
4. **Line 665-676**: Session state transition fails
5. **Line 679-698**: Notification creation fails (shouldn't block execution)
6. **Silent catch block** (line 702-706): Error logged but returns false

---

## SSOT Violations Detected

### ❌ Violation 1: Dual Pip Value Systems
**Problem**: Two conflicting sources of truth for pip values
**Impact**: 100x mismatch for metals, potential zone check failures
**Fix Required**: Unify pip value system or clearly separate concerns

### ❌ Violation 2: Silent Execution Failures
**Problem**: `executeIntent()` returns false without detailed reason
**Impact**: "EXECUTE_READY" logs but execution silently fails
**Fix Required**: Add comprehensive error tracking and logging

### ❌ Violation 3: No Execution Audit Trail
**Problem**: Can't determine which step in executeIntent failed
**Impact**: Unable to diagnose execution failures in production
**Fix Required**: Add step-by-step execution logging to database

---

## Recommended Fixes (CCIP Compliant)

### Fix 1: Unify Pip Value System (SSOT)
**Priority**: P0
**Impact**: High
**Approach**:
- Make `currencyHelpers.ts` THE authority for ALL pip values
- Update `adaptive-entry-zone-calculator.ts` to use `getCurrencyPipInfo()`
- Remove pip values from `symbol-registry.ts` or mark as deprecated
- Add validation to ensure zone calculations use same pip values as checks

### Fix 2: Add Execution Audit Trail
**Priority**: P0
**Impact**: High
**Approach**:
- Create `entry_execution_audit` table
- Log each step of `executeIntent()`: fetch, insert, update, transition
- Return detailed failure reason instead of just false
- Add execution step timing for performance monitoring

### Fix 3: Add Pre-Execution Validation
**Priority**: P1
**Impact**: Medium
**Approach**:
- Before calling `executeIntent()`, validate:
  - User has sufficient balance
  - Session is still active
  - Intent hasn't already been executed (race condition)
  - Price data is recent enough
- Log validation failures with clear reasons

### Fix 4: Add Execution Retry Logic
**Priority**: P2
**Impact**: Low
**Approach**:
- If execution fails due to transient error, retry once
- Track retry attempts in database
- Don't retry on business logic failures (invalid SL, insufficient balance)

---

## Investigation Checklist

Before implementing fixes, gather data from production:

- [ ] Check `entry_monitoring_logs` for "EXECUTE_READY" without corresponding trade
- [ ] Check `goal_session_trades` for failed insertions (error logs)
- [ ] Check if intents have `status='executed'` but no trade exists
- [ ] Verify pip value used in zone calculations vs zone checks
- [ ] Review database constraints that could block trade insertion
- [ ] Check RLS policies on `goal_session_trades` for service_role

---

## Next Steps

1. **Immediate**: Add comprehensive logging to `executeIntent()` function
2. **Short-term**: Audit and unify pip value system
3. **Medium-term**: Add execution audit trail table
4. **Long-term**: Implement intelligent execution retry logic

---

## Alpha Decision Authority Reminder

> **"Engines validate. Alpha decides. Trades degrade intelligently — they do not silently mutate or over-block."**

Current system violates this:
- Silent failures in `executeIntent()` (no degradation, just blocks)
- No Alpha involvement in execution retry decisions
- No intelligent fallback when execution fails

**Required**: Execution failures should trigger Alpha consultation, not silent blocking.
