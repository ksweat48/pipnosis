# Phase 2, Section 3: Risk Calculation Consolidation - Implementation Plan

**Status:** IN PROGRESS
**Priority:** HIGH - Eliminate position sizing duplicates
**CCIP Stage:** System Map → Logic Contract → Implementation

---

## Executive Summary

**Goal:** Consolidate all risk calculation and position sizing logic to use `ProfessionalRiskManager` as the Single Source of Truth (SSOT).

**Problem:** Multiple services implement their own position sizing calculations, creating duplicate logic and risk of inconsistency.

**Solution:** Route all position sizing through ProfessionalRiskManager, eliminating 4+ duplicate implementations.

---

## Current State Analysis

### SSOT Authority (Correct)
- **ProfessionalRiskManager** (`src/services/professional-risk-manager.ts`)
  - Method: `evaluateTrade()`
  - Responsibilities:
    - Risk-per-trade calculation
    - Position sizing based on account balance
    - Exposure limit validation
    - Risk mode enforcement (exploration vs normal)
    - Progressive risk scaling

### Violations Found (From Build Output)

1. **entry-execution-coordinator.ts**
   - Contains: `calculateLotSizeFromDollarRisk()`
   - Issue: Duplicate position sizing logic

2. **event-based-llm-engine.ts**
   - Contains: `calculatePositionSize()`
   - Issue: Duplicate position sizing logic

3. **goal-feasibility-resolver.ts**
   - Contains: `calculatePositionSize()`
   - Issue: Duplicate position sizing logic

4. **goal-session-live-engine.ts**
   - Contains: Multiple position sizing functions:
     - `calculateLotSizeFromDollarRisk()`
     - `calculateGoalAwareLotSize()`
     - `calculatePositionSize()`
   - Issue: Significant duplication

### Additional Services (Warning)
These services were flagged as handling position sizing without importing ProfessionalRiskManager:
- coordinators/trade-closure-coordinator.ts
- entry-monitor-coordinator.ts
- modal-notification-bridge.ts
- position-monitor.ts

---

## Implementation Strategy

### Phase 1: Understand ProfessionalRiskManager API

Read and document the correct usage pattern:
```typescript
// Correct pattern
const riskEval = await professionalRiskManager.evaluateTrade({
  userId,
  sessionId,
  symbol,
  direction,
  entry,
  stopLoss,
  balance,
  openPositions,
  // ... other params
});

// Returns: { lotSize, riskPercent, riskAmount, allowed, blockReason }
```

### Phase 2: Fix Each Violator

**Strategy for each file:**
1. Import ProfessionalRiskManager
2. Identify all position sizing calculations
3. Replace with `professionalRiskManager.evaluateTrade()` call
4. Remove duplicate helper functions
5. Add Phase 2 Section 3 comment markers

---

## File-by-File Implementation Plan

### File 1: entry-execution-coordinator.ts

**Current Issue:**
- Implements `calculateLotSizeFromDollarRisk()` locally

**Fix:**
```typescript
// BEFORE
const lotSize = calculateLotSizeFromDollarRisk(
  riskAmount,
  symbol,
  entry,
  stopLoss
);

// AFTER
const riskEval = await professionalRiskManager.evaluateTrade({
  userId,
  sessionId,
  symbol,
  direction,
  entry,
  stopLoss,
  balance,
  openPositions
});
const lotSize = riskEval.lotSize;
```

**Impact:** Entry execution uses consistent position sizing

---

### File 2: event-based-llm-engine.ts

**Current Issue:**
- Implements `calculatePositionSize()` locally

**Fix:**
```typescript
// BEFORE
const positionSize = calculatePositionSize(
  balance,
  riskPercent,
  symbol,
  entry,
  stopLoss
);

// AFTER
const riskEval = await professionalRiskManager.evaluateTrade({
  userId,
  sessionId,
  symbol,
  direction,
  entry,
  stopLoss,
  balance,
  openPositions
});
const positionSize = riskEval.lotSize;
```

**Impact:** LLM-based trading uses consistent position sizing

---

### File 3: goal-feasibility-resolver.ts

**Current Issue:**
- Implements `calculatePositionSize()` locally

**Fix:**
```typescript
// BEFORE
const lotSize = calculatePositionSize(
  balance,
  riskPercent,
  symbol,
  entry,
  stopLoss
);

// AFTER
const riskEval = await professionalRiskManager.evaluateTrade({
  userId,
  sessionId,
  symbol,
  direction,
  entry,
  stopLoss,
  balance,
  openPositions
});
const lotSize = riskEval.lotSize;
```

**Impact:** Goal feasibility calculations use consistent sizing

---

### File 4: goal-session-live-engine.ts (HIGH COMPLEXITY)

**Current Issues:**
- Multiple duplicate functions:
  - `calculateLotSizeFromDollarRisk()`
  - `calculateGoalAwareLotSize()`
  - `calculatePositionSize()`

**Fix Strategy:**
1. Replace all three with ProfessionalRiskManager calls
2. Preserve goal-aware logic if needed (may be valid specialization)
3. Ensure progressive scaling is handled by ProfessionalRiskManager

**Impact:** Goal sessions use consistent position sizing

---

## Risk Assessment

### Low Risk Changes
- entry-execution-coordinator.ts (straightforward replacement)
- event-based-llm-engine.ts (straightforward replacement)
- goal-feasibility-resolver.ts (straightforward replacement)

### Medium Risk Changes
- goal-session-live-engine.ts (multiple functions, goal-specific logic)

### Verification Strategy
1. Ensure all tests pass
2. Verify position sizes remain consistent
3. Check that risk limits are enforced
4. Validate goal-aware behavior preserved

---

## Expected Benefits

### Code Quality
- ✅ Eliminate 4+ duplicate position sizing implementations
- ✅ Reduce ~200-300 lines of duplicate code
- ✅ Single point of update for risk logic
- ✅ Consistent risk management across all flows

### Risk Management
- ✅ All position sizing enforces platform risk limits
- ✅ No divergent risk calculations
- ✅ Centralized risk mode enforcement
- ✅ Progressive risk scaling applied consistently

### Maintainability
- ✅ Update risk logic once, applies everywhere
- ✅ Easier to test (test one service thoroughly)
- ✅ Clear ownership of risk calculations
- ✅ No risk of calculation drift

---

## Testing Checklist

After implementation:
- [ ] Build passes without errors
- [ ] All position sizing uses ProfessionalRiskManager
- [ ] Risk limits enforced consistently
- [ ] Goal-aware logic preserved
- [ ] Exploration mode handled correctly
- [ ] No duplicate calculations remain

---

## Rollback Plan

If issues arise:
1. Revert individual file changes
2. Full rollback via git revert
3. Redeploy previous version

---

## Success Criteria

1. ✅ Zero duplicate position sizing implementations
2. ✅ All services import ProfessionalRiskManager
3. ✅ Build passes with no violations
4. ✅ All tests pass
5. ✅ Position sizes remain consistent with previous behavior

---

## Next Steps

1. Read ProfessionalRiskManager to understand API
2. Fix entry-execution-coordinator.ts
3. Fix event-based-llm-engine.ts
4. Fix goal-feasibility-resolver.ts
5. Fix goal-session-live-engine.ts
6. Build and test
7. Deploy to production

---

**CCIP Compliance:** Following System Map → Logic Contract → Implementation → Testing → Deployment
