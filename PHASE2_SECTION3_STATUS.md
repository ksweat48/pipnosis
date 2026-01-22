# Phase 2, Section 3: Risk Calculation Consolidation - STATUS

**Current Status:** DEFERRED - Requires Deeper Architectural Review
**Priority:** MEDIUM - Real violations found, but complex to fix
**Date:** January 22, 2026

---

## Executive Summary

Phase 2 Section 3 investigation revealed that most "position sizing violations" were false positives from comments in the architectural compliance test. After fixing the test to strip comments, only 2 real violations remain:

1. **goal-feasibility-resolver.ts** - Simplified position sizing for feasibility estimation
2. **goal-session-live-engine.ts** - Position sizing for goal amount estimation

**Decision:** DEFER to future phase due to complexity of distinguishing legitimate estimation logic from actual position sizing.

---

## What Was Found

### False Positives (Fixed)
- **entry-execution-coordinator.ts** - Already uses ProfessionalRiskManager (comment mentioned old function name)
- **event-based-llm-engine.ts** - Already uses ProfessionalRiskManager (comment mentioned old function name)

### Real Violations (Require Design Decision)

#### 1. goal-feasibility-resolver.ts
**Location:** Lines 577-584
```typescript
private static calculatePositionSize(
  targetProfit: number,
  adjustedATR: number,
  currentPrice: number
): number {
  if (adjustedATR === 0) return 0.01;
  return Math.max(0.01, (targetProfit / (adjustedATR * 10)) * 0.01);
}
```

**Nature:** Simplified estimation formula for feasibility checking
**Purpose:** Quick calculation to determine if goal is achievable
**Issue:** Not actual trade execution, but violates SSOT principle

#### 2. goal-session-live-engine.ts
**Location:** Line 823
```typescript
const estimatedLotSize = calculatePositionSize(
  estimationRef.symbol,
  config.initialBalance,
  riskPercent,
  ESTIMATION_REFERENCE_ENTRY,  // NOT REAL PRICE
  ESTIMATION_REFERENCE_STOP,   // NOT REAL PRICE
  true  // isEstimation flag
);
```

**Nature:** Estimation call for goal amount calculation
**Purpose:** Calculate projected position sizes for goal planning
**Issue:** Uses utility function instead of ProfessionalRiskManager

---

## Architectural Question

**Should estimation/feasibility calculations use the same SSOT as execution?**

### Arguments FOR Consolidation:
- ✅ Consistency across all calculations
- ✅ Single point of update
- ✅ Ensures estimations match reality
- ✅ No calculation drift

### Arguments AGAINST Consolidation:
- ❌ Estimations may need simplified/faster logic
- ❌ ProfessionalRiskManager is async (requires DB calls)
- ❌ Estimations don't need full Kelly/EV/correlation logic
- ❌ May over-engineer simple feasibility checks

---

## Recommended Approach (Future)

**Option 1: Create EstimationRiskCalculator** (Preferred)
- New service for pre-trade estimations
- Simplified, synchronous logic
- Clear separation from execution path
- Updates architectural compliance test to allow this exception

**Option 2: Add Estimation Mode to ProfessionalRiskManager**
- Add `estimationMode: boolean` parameter
- Skip expensive calculations in estimation mode
- Return simplified results
- Maintains SSOT but adds complexity

**Option 3: Accept as Valid Exceptions**
- Document these as legitimate estimation exceptions
- Update architectural test to allow them
- Ensure they're clearly marked as estimations
- Risk: calculations may drift over time

---

## What Was Fixed

### Test Improvement
**File:** `src/tests/architectural-compliance.test.ts`
**Change:** Strip comments before checking for violations

**Before:**
```typescript
const content = readFileContent(file);
for (const pattern of forbiddenPatterns) {
  if (pattern.test(content)) {
    violations.push(...);
  }
}
```

**After:**
```typescript
let content = readFileContent(file);

// ✅ PHASE 2 SECTION 3: Strip comments to avoid false positives
content = content.replace(/\/\/.*$/gm, '');
content = content.replace(/\/\*[\s\S]*?\*\//g, '');

for (const pattern of forbiddenPatterns) {
  if (pattern.test(content)) {
    violations.push(...);
  }
}
```

**Impact:** Eliminated false positives from Phase 2 refactor comments

---

## Current Violations Summary

| File | Violation | Type | Complexity |
|------|-----------|------|------------|
| goal-feasibility-resolver.ts | Custom calculatePositionSize | Estimation | Medium |
| goal-session-live-engine.ts | Calls calculatePositionSize | Estimation | Medium |

**Total:** 2 real violations (down from 6 reported)

---

## Decision

**DEFER to future phase** for the following reasons:

1. **Estimation vs Execution Distinction**
   - Need architectural decision on how to handle estimations
   - Current violations are pre-trade feasibility checks, not execution
   - Unclear if SSOT should apply to estimations

2. **Complexity vs Benefit**
   - Fixing requires new estimation framework or ProfessionalRiskManager refactor
   - Benefit is consistency, but estimations already clearly marked
   - Phase 2 Section 4 (Market Data) has clearer violations and higher impact

3. **No Immediate Risk**
   - These calculations are for planning, not execution
   - Actual trade execution already uses ProfessionalRiskManager
   - No production incidents related to these calculations

---

## Phase 2 Section 3 Deliverables

- ✅ Architectural compliance test improved (strips comments)
- ✅ False positives eliminated (4 out of 6)
- ✅ Real violations identified and analyzed (2 remaining)
- ✅ Architectural decision documented
- ⏳ Actual fixes deferred to future phase

---

## Next Steps

1. **Proceed to Phase 2 Section 4** (Market Data Consolidation)
   - Clear violations with obvious fixes
   - Higher impact on system consistency
   - No architectural ambiguity

2. **Revisit Section 3 in Phase 3** (Enforcement)
   - Design estimation framework
   - Implement chosen approach
   - Update architectural tests accordingly

---

## Documentation

- `PHASE2_SECTION3_RISK_CALCULATION_PLAN.md` - Original implementation plan
- `PHASE2_SECTION3_STATUS.md` - This status document

---

**Status:** Section 3 investigation complete, fixes deferred
**Decision:** Move to Section 4 (higher impact, clearer fixes)
**Impact:** Test improvements deployed, SSOT violations documented for future work
