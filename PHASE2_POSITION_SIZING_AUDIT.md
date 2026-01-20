# Phase 2: Position Sizing Consolidation - Audit Report

**Date:** 2026-01-20
**Status:** 🔴 CRITICAL VIOLATIONS FOUND
**Priority:** P0 - Immediate Action Required

---

## Executive Summary

**Critical Finding:** Position sizing logic is duplicated across 3+ locations, bypassing ProfessionalRiskManager's comprehensive risk analysis. This creates:
- Inconsistent position sizing across different execution paths
- Risk management bypass (no Kelly Criterion, EV Gating, volatility adjustments)
- Maintenance nightmare (fix in one place doesn't fix others)
- Potential for 10-100x risk violations

**Impact:** High - Affects all trade executions
**Complexity:** Medium - Clear refactoring path
**Estimated Time:** 4-6 hours

---

## SSOT Violations Found

### 1. **VIOLATION: currencyHelpers.ts - Duplicate Position Sizing Functions**

**Location:** `/src/utils/currencyHelpers.ts`

**Duplicate Functions:**
1. `calculatePositionSize()` (line 545) - Risk percentage based
2. `calculateLotSizeFromDollarRisk()` (line 420) - Fixed dollar risk based
3. `calculateGoalAwareLotSize()` (line 827) - Goal-aware sizing

**Problem:**
These functions calculate position size WITHOUT calling ProfessionalRiskManager, bypassing:
- ❌ Kelly Criterion optimization
- ❌ EV Gating validation
- ❌ Volatility adjustments
- ❌ Correlation risk checks
- ❌ Market condition risk modifiers
- ❌ Progressive risk scaling
- ❌ PCVL (Position Contract Validation Layer)

**Impact:** Every trade using these helpers bypasses 7 layers of risk protection

---

### 2. **VIOLATION: goal-session-live-engine.ts - Direct Position Sizing**

**Location:** `/src/services/goal-session-live-engine.ts`

**Violations:**
- **Line 821:** `calculatePositionSize()` - Feasibility estimation
- **Line 1194:** `calculateLotSizeFromDollarRisk()` - Trade execution

**Current Flow:**
```
goal-session-live-engine
  └─> calculatePositionSize() ❌ BYPASS
  └─> calculateLotSizeFromDollarRisk() ❌ BYPASS
```

**Correct Flow:**
```
goal-session-live-engine
  └─> ProfessionalRiskManager.evaluateTrade() ✅ AUTHORITY
       └─> Kelly Criterion
       └─> EV Gating
       └─> Volatility Adjustment
       └─> Correlation Check
       └─> Market Condition Risk
       └─> Progressive Risk Scaling
       └─> Returns recommendedLotSize ✅
```

---

### 3. **VIOLATION: entry-execution-coordinator.ts - Direct Position Sizing**

**Location:** `/src/services/entry-execution-coordinator.ts`

**Violation:**
- **Line 254:** `calculateLotSizeFromDollarRisk()` - Entry intent execution

**Current Code:**
```typescript
const lotSize = calculateLotSizeFromDollarRisk(
  intent.symbol,
  riskDollars,
  actualEntryPrice,
  adjustedStopLoss
);
```

**Problem:** Bypasses ProfessionalRiskManager entirely

**Fix Required:** Call ProfessionalRiskManager.evaluateTrade() instead

---

### 4. **ACCEPTABLE: trade-execution-engine.ts - PCVL Validation**

**Location:** `/src/services/trade-execution-engine.ts`

**Status:** ✅ COMPLIANT (receives position size from signal, validates with PCVL)

**Analysis:**
- Does NOT calculate position size internally
- Receives pre-calculated `signal.positionSize` from caller
- Validates with PCVL as last-line defense
- **No refactoring needed** (validation only, not calculation)

---

## Refactoring Plan

### Phase 2.1: Refactor goal-session-live-engine.ts

**Target Lines:** 821, 1194

**Current Code (Line 1194):**
```typescript
lotSize = calculateLotSizeFromDollarRisk(
  selectedSymbol,
  config.dollarRisk,
  decision.entry,
  decision.stopLoss
);
```

**Refactored Code:**
```typescript
// Call ProfessionalRiskManager for comprehensive risk evaluation
const riskAssessment = await professionalRiskManager.evaluateTrade({
  userId: this.userId!,
  symbol: selectedSymbol,
  direction: decision.action === 'BUY' ? 'long' : 'short',
  currentBalance: this.currentBalance,
  stopLossPips: Math.abs(decision.entry - decision.stopLoss) / getCurrencyPipInfo(selectedSymbol).pipValue,
  takeProfitPips: Math.abs(decision.takeProfit - decision.entry) / getCurrencyPipInfo(selectedSymbol).pipValue,
  goalSessionId: this.activeSession,
  riskMode: config.riskMode || 'medium'
});

if (!riskAssessment.approved) {
  console.warn('[Goal Session] Trade rejected by ProfessionalRiskManager:', riskAssessment.criticalWarnings);
  // Handle rejection (skip trade, log reason)
  return;
}

const lotSize = riskAssessment.recommendedLotSize;
console.log(`[Goal Session] ProfessionalRiskManager approved: ${lotSize} lots (risk: ${(riskAssessment.adjustedRiskPercent * 100).toFixed(2)}%)`);
```

**Benefits:**
- ✅ Kelly Criterion optimization applied
- ✅ EV Gating validation performed
- ✅ Volatility adjustments included
- ✅ Correlation risk checked
- ✅ Market condition modifiers applied
- ✅ Progressive risk scaling active

---

### Phase 2.2: Refactor entry-execution-coordinator.ts

**Target Line:** 254

**Current Code:**
```typescript
const lotSize = calculateLotSizeFromDollarRisk(
  intent.symbol,
  riskDollars,
  actualEntryPrice,
  adjustedStopLoss
);
```

**Refactored Code:**
```typescript
const { professionalRiskManager } = await import('./professional-risk-manager');
const { calculatePipDistance } = await import('../utils/currencyHelpers');

const stopPips = calculatePipDistance(intent.symbol, actualEntryPrice, adjustedStopLoss);
const takeProfitPips = marketContext?.take_profit
  ? calculatePipDistance(intent.symbol, actualEntryPrice, marketContext.take_profit)
  : stopPips * 2; // Default 2:1 R:R

const riskAssessment = await professionalRiskManager.evaluateTrade({
  userId: intent.user_id,
  symbol: intent.symbol,
  direction: intent.direction,
  currentBalance: await this.getUserBalance(intent.user_id), // Helper function needed
  stopLossPips: stopPips,
  takeProfitPips: takeProfitPips,
  goalSessionId: intent.session_id,
  riskMode: 'medium' // Get from session config
});

if (!riskAssessment.approved) {
  logger.warn(`[Entry Execution] Risk assessment rejected: ${riskAssessment.criticalWarnings.join(', ')}`);
  // Mark intent as rejected
  await EntryPlannerService.updateIntentStatus(intentId, 'rejected', 'Risk assessment failed');
  return { success: false };
}

const lotSize = riskAssessment.recommendedLotSize;
logger.info(`[Entry Execution] Risk approved: ${lotSize} lots (confidence: ${riskAssessment.confidenceScore})`);
```

---

### Phase 2.3: Deprecate Direct Calculation Functions

**Target File:** `/src/utils/currencyHelpers.ts`

**Action:** Mark functions as deprecated, add warnings

**Functions to Deprecate:**
1. `calculatePositionSize()`
2. `calculateLotSizeFromDollarRisk()`
3. `calculateGoalAwareLotSize()`

**Add JSDoc Warnings:**
```typescript
/**
 * @deprecated Use ProfessionalRiskManager.evaluateTrade() instead
 * This function bypasses Kelly Criterion, EV Gating, volatility adjustments,
 * correlation checks, market condition risk, and progressive risk scaling.
 *
 * Keeping for backward compatibility only. Will be removed in Phase 3.
 */
export function calculatePositionSize(...) {
  console.warn('[SSOT VIOLATION] calculatePositionSize() called directly. Use ProfessionalRiskManager.evaluateTrade()');
  // ... existing code
}
```

**Note:** Functions stay for now (Phase 3 removal) to avoid breaking tests/legacy code

---

## Validation Checklist

After refactoring, verify:

- [ ] All trades go through ProfessionalRiskManager.evaluateTrade()
- [ ] Kelly Criterion sizing applied to all trades
- [ ] EV Gating validates all trades
- [ ] Volatility adjustments active
- [ ] Correlation risk checked for concurrent trades
- [ ] Market condition risk modifiers applied
- [ ] Progressive risk scaling based on recent performance
- [ ] PCVL validation as final checkpoint
- [ ] No direct calls to deprecated functions (search codebase)
- [ ] Build passes without errors
- [ ] Integration tests pass
- [ ] Manual test: Create goal session, execute trade, verify position size

---

## Risk Assessment

**Before Refactoring:**
- 🔴 Position sizing inconsistent across execution paths
- 🔴 7 layers of risk protection bypassed
- 🔴 Kelly Criterion not applied
- 🔴 No EV Gating validation
- 🔴 Correlation risk unchecked

**After Refactoring:**
- ✅ Single source of truth (ProfessionalRiskManager)
- ✅ All 7 risk layers active
- ✅ Consistent position sizing
- ✅ Fix bug once, everywhere benefits
- ✅ Future-proof architecture

---

## Success Metrics

1. **Code Quality:**
   - Zero direct calls to `calculatePositionSize()` from services
   - Zero direct calls to `calculateLotSizeFromDollarRisk()` from services
   - All trades route through ProfessionalRiskManager

2. **Functional:**
   - Position sizes consistent across manual/auto execution
   - Kelly Criterion active (verify with logs)
   - EV Gating active (verify rejections work)
   - Correlation checks working (test concurrent trades)

3. **Safety:**
   - PCVL blocks trades as expected
   - No 10x+ risk violations
   - Risk percentages within configured ranges

---

## Next Steps

1. ✅ **Audit Complete** (this document)
2. 🔄 **Refactor goal-session-live-engine.ts** (next)
3. 🔄 **Refactor entry-execution-coordinator.ts**
4. 🔄 **Add deprecation warnings to currencyHelpers**
5. 🔄 **Test and verify**
6. 🔄 **Update documentation**

---

## Related Files

- `/src/services/professional-risk-manager.ts` (AUTHORITY)
- `/src/services/goal-session-live-engine.ts` (NEEDS REFACTOR)
- `/src/services/entry-execution-coordinator.ts` (NEEDS REFACTOR)
- `/src/services/trade-execution-engine.ts` (COMPLIANT)
- `/src/utils/currencyHelpers.ts` (DEPRECATE FUNCTIONS)

---

**Audit By:** CCIP Governance System
**Review Status:** Pending Implementation
**Estimated Completion:** 4-6 hours
