# ALPHA WAIT REMOVAL - CCIP Implementation Plan

**Date**: 2026-01-20
**Priority**: P1 - Architecture Simplification
**Status**: Implementation

## Executive Summary

Remove WAIT action from Alpha's decision vocabulary entirely. Alpha now returns only:
- **BUY**: Execute buy immediately at market price
- **SELL**: Execute sell immediately at market price
- **NO_TRADE**: Not ready yet, keep scanning

This eliminates the entry monitoring system complexity and returns to a simpler "execute or keep scanning" model.

---

## System Map

### Current Architecture
```
Alpha Decision Types: EXECUTE_NOW, WAIT, PASS
├── EXECUTE_NOW → Execute trade immediately
├── WAIT → Create entry intent, start monitoring, wait for optimal zone
└── PASS → No trade, keep scanning
```

### New Architecture
```
Alpha Decision Types: BUY, SELL, NO_TRADE
├── BUY → Execute buy immediately at market price
├── SELL → Execute sell immediately at market price
└── NO_TRADE → Not ready yet, keep scanning (replaces both WAIT and PASS)
```

### Affected Components (SSOT Mapping)

#### 1. **Type Definitions** (SSOT: alpha-decision-contract.ts)
- `AlphaAction` type definition
- Contract validators
- Helper functions (createExecuteNowContract, createWaitContract, createPassContract)

#### 2. **Alpha Coordinator** (SSOT: coordinator-alpha.ts)
- LLM prompt (Alpha's instruction set)
- Response parser (reads Alpha's JSON output)
- Action validation logic

#### 3. **Goal Session Live Engine** (SSOT: goal-session-live-engine.ts)
- WAIT→NO_TRADE conversion logic (lines 1136-1147)
- Decision handling flow

#### 4. **Supporting Services**
- best-symbol-selector.ts: WAIT scoring logic
- safety-enforcer.ts: WAIT skip validation
- alpha-thought-stream.ts: WAIT counters and messages
- goal-scanner.ts: WAIT monitoring count
- entry-execution-coordinator.ts: WAIT condition creation
- trade-candidate-manager.ts: WAIT→WAIT_HIGHER_EDGE mapping

---

## Logic Contract

### Removed Behaviors
1. ❌ Alpha cannot return WAIT action
2. ❌ No entry intent creation for monitoring
3. ❌ No entry zone/invalidation zone tracking
4. ❌ No "wait for better price" logic

### New Behaviors
1. ✅ Alpha returns BUY/SELL with immediate execution semantics
2. ✅ Alpha returns NO_TRADE when setup is not ready
3. ✅ Scanner continues on NO_TRADE (same as before)
4. ✅ All decisions are market-execution or pass

### SSOT Compliance
- **Single Authority**: Alpha coordinator is only source of trading decisions
- **No Silent Mutations**: Remove WAIT→NO_TRADE conversion
- **Clear Semantics**: Action type matches intent (BUY means buy now)

---

## Dry-Run Simulation

### Test Case 1: Executable Setup
**Current**:
```json
{
  "action": "EXECUTE_NOW",
  "tradeSpec": {"direction": "BUY", "symbol": "EURUSD", ...}
}
```

**New**:
```json
{
  "action": "BUY",
  "tradeSpec": {"symbol": "EURUSD", ...}
}
```
**Result**: ✅ Trade executes immediately (behavior unchanged)

---

### Test Case 2: Not Ready Yet
**Current**:
```json
{
  "action": "WAIT",
  "waitDecision": {"entryPlan": {...}, ...}
}
```

**New**:
```json
{
  "action": "NO_TRADE",
  "reasoning": "Setup not ready - spread too wide, waiting for better conditions"
}
```
**Result**: ✅ Scanner continues, Alpha re-evaluates next cycle

---

### Test Case 3: No Quality Setup
**Current**:
```json
{
  "action": "PASS",
  "reasoning": "No quality setups"
}
```

**New**:
```json
{
  "action": "NO_TRADE",
  "reasoning": "No quality setups found across watchlist"
}
```
**Result**: ✅ Scanner continues (behavior unchanged)

---

## Compatibility Check

### Breaking Changes
1. ❌ **WAIT action removed**: Any code checking `action === 'WAIT'` will break
2. ❌ **Direction embedded in action**: Must update direction logic
3. ❌ **WaitDecision removed**: Entry plan infrastructure obsolete

### Non-Breaking Changes
1. ✅ **Execution flow**: Still executes immediately on actionable decision
2. ✅ **Scanner behavior**: Still continues on non-actionable decision
3. ✅ **Database schema**: No schema changes required

### Migration Strategy
- Update all `action === 'WAIT'` checks to `action === 'NO_TRADE'`
- Extract direction from action itself, not tradeSpec.direction
- Remove entry intent creation logic
- Clean up orphaned WAIT infrastructure

---

## Staged Deployment

### Phase 1: Type & Core Logic (This Deploy)
- Update alpha-decision-contract.ts types
- Update coordinator-alpha.ts prompt and parser
- Remove WAIT handling from live engine
- Update best-symbol-selector, safety-enforcer, thought-stream

### Phase 2: Post-Deploy Verification
- Monitor Alpha decisions for WAIT leakage
- Verify NO_TRADE count increases (replaces WAIT)
- Confirm trade execution rates unchanged
- Check for any parsing errors

### Phase 3: Cleanup (Follow-up)
- Remove entry monitoring infrastructure if unused
- Archive WAIT-related migrations
- Update documentation

---

## Post-Deploy Verification

### Success Criteria
1. ✅ No Alpha decisions contain `action: "WAIT"`
2. ✅ All Alpha decisions are BUY, SELL, or NO_TRADE
3. ✅ NO_TRADE count increases (absorbs old WAIT + PASS)
4. ✅ Trade execution rates remain stable
5. ✅ No TypeScript errors in production logs
6. ✅ Scanner continues normally on NO_TRADE

### Monitoring (First Hour)
```sql
-- Check for WAIT leakage
SELECT action, COUNT(*)
FROM alpha_brain_outputs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY action;

-- Expected: 0 WAIT actions, increased NO_TRADE count
```

### Rollback Plan
If critical issues:
1. Revert coordinator-alpha.ts to previous version
2. Revert alpha-decision-contract.ts types
3. Restore WAIT handling in live engine
4. Redeploy immediately

---

## Implementation Checklist

- [ ] Update alpha-decision-contract.ts
- [ ] Update coordinator-alpha.ts prompt
- [ ] Update coordinator-alpha.ts parser
- [ ] Remove WAIT handling from goal-session-live-engine.ts
- [ ] Update best-symbol-selector.ts
- [ ] Update safety-enforcer.ts
- [ ] Update alpha-thought-stream.ts
- [ ] Update goal-scanner.ts
- [ ] Remove entry-execution-coordinator.ts WAIT logic
- [ ] Update trade-candidate-manager.ts
- [ ] Run build verification
- [ ] Deploy to production
- [ ] Monitor for 1 hour
- [ ] Verify success criteria

---

**CCIP Compliance**: ✅ Complete
- System map created
- Logic contract defined
- Dry-run simulation executed
- Compatibility assessed
- Staged deployment planned
- Post-deploy verification ready
