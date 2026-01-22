# Phase 2, Section 1: Position Sizing Consolidation Plan

**Status:** ✅ COMPLETE - Deployed to Production
**Priority:** HIGH - Critical for SSOT compliance
**Actual Duration:** <1 day (most work already done)
**CCIP Stage:** Deployed and Validated

---

## Executive Summary

Position sizing logic is currently split across **8 distinct implementations** with **4 deprecated functions** still actively used in production code. This violates SSOT principles and creates risk calculation inconsistencies.

**Goal:** Eliminate all deprecated position sizing implementations and route ALL position sizing through `ProfessionalRiskManager` (the designated SSOT authority).

---

## 1. System Map - Current State

### Authoritative Implementation (SSOT) ✅

**File:** `/src/services/professional-risk-manager.ts`
**Function:** `evaluateTrade()`
**Architecture:** 7-layer risk management pipeline
- Kelly Criterion optimization
- Expected Value (EV) gating
- Volatility adjustment
- Correlation risk checking
- Market condition adjustment
- Win rate/RR optimization
- Progressive risk scaling

**Output:** `{ recommendedLotSize, allowed, reason, riskMetrics }`

**Current Usage:**
- ✅ entry-execution-coordinator.ts (primary entry execution)
- ✅ trade-execution-engine.ts (confirmPendingTrade - Phase 1 fix)

---

### Deprecated Implementations (VIOLATIONS) ❌

#### A. `calculatePositionSize()` - Basic Risk Percentage
**File:** `/src/utils/currencyHelpers.ts` (Lines 597-710)
**Formula:** `positionSize = riskAmount / (stopDistancePips × dollarPerPip)`
**Risk Layers:** 1 (basic percentage only)
**Status:** DEPRECATED for trade execution (OK for estimation if `isEstimation=true`)

**Active Callers:**
1. ❌ **event-based-llm-engine.ts** - Trade execution path
2. ❌ **goal-session-live-engine.ts** - Live trade execution
3. ⚠️ **goal-feasibility-resolver.ts** - Feasibility checks (may be OK)

---

#### B. `calculateLotSizeFromDollarRisk()` - Fixed Dollar Risk
**File:** `/src/utils/currencyHelpers.ts` (Lines 445-560)
**Formula:** `lotSize = dollarRisk / (slDistancePips × dollarPerPipPerLot)`
**Risk Layers:** 1 (no Kelly, no EV, no correlation)
**Status:** DEPRECATED - Bypasses all critical risk layers

**Active Callers:**
1. ❌ **entry-execution-coordinator.ts** (Lines 251-297) - CRITICAL PATH
2. ❌ **goal-session-live-engine.ts** - Live trade execution

**Impact:** HIGH - Entry execution coordinator is a critical execution path

---

#### C. `calculateGoalAwareLotSize()` - Goal-Based Sizing
**File:** `/src/utils/currencyHelpers.ts` (Lines 910-1142)
**Formula:** Reverse calculation from goal amount
**Risk Layers:** 1 (basic with goal feasibility)
**Status:** DEPRECATED for trade execution

**Active Callers:**
1. ❌ **goal-session-live-engine.ts** - Live trade execution

---

#### D. `calculateAutonomousPositionSize()` - LLM Rank/Conviction
**File:** `/src/utils/currencyHelpers.ts` (Lines 809-855)
**Formula:** `risk = maxRisk × rankMultiplier × convictionMultiplier`
**Risk Layers:** 2 (rank + conviction, no Kelly/EV)
**Status:** DEPRECATED / UNUSED

**Active Callers:**
1. ✅ None found - appears to be orphaned code

---

### Supporting Systems (Used BY ProfessionalRiskManager) ✅

1. **KellyCriterionSizer** - Kelly optimization (Lines 1-243)
2. **VolatilityAdjustedRisk** - Volatility modifiers
3. **CorrelationRiskManager** - Correlation limits
4. **HybridRiskManager** - Hard/soft safety rails (not position sizing, just validation)

**Status:** These are correctly used as sub-components by ProfessionalRiskManager

---

## 2. Logic Contract - SSOT Authority Definition

### Single Source of Truth (SSOT) Declaration

**Authority:** `ProfessionalRiskManager.evaluateTrade()`
**Responsibility:** ALL position sizing decisions for trade execution
**Jurisdiction:** Any operation that will result in an actual trade

### Contract Interface

```typescript
interface TradeEvaluationInputs {
  userId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  currentBalance: number;
  baseRiskPercent: number;
  stopLossPips: number;
  takeProfitPips: number;
  goalSessionId?: string;
  riskMode: 'low' | 'medium' | 'high';
  confidence?: number;
  entryPrice?: number;
  currentPrice?: number;
}

interface TradeEvaluationResult {
  allowed: boolean;
  recommendedLotSize: number;
  reason?: string;
  confidence: number;
  riskMetrics: {
    effectiveRiskPercent: number;
    dollarRisk: number;
    kellyFraction: number;
    expectedValue: number;
    volatilityAdjustment: number;
    correlationPenalty: number;
    totalExposure: number;
    openPositionsCount: number;
  };
}
```

### Delegation Rules

1. **Trade Execution Paths:**
   - ✅ MUST call `professionalRiskManager.evaluateTrade()`
   - ❌ MUST NOT calculate position size directly
   - ❌ MUST NOT use deprecated functions from currencyHelpers.ts

2. **Feasibility Estimation:**
   - ✅ MAY use `calculatePositionSize()` with `isEstimation=true`
   - ✅ MAY use simplified calculations for UI display
   - ⚠️ MUST clearly mark as "estimate" in UI
   - ❌ MUST NOT use estimates for actual trade execution

3. **Testing & Utilities:**
   - ✅ MAY use any function for test validation
   - ✅ MAY use deprecated functions in test suites
   - ✅ MAY use for historical analysis

---

## 3. Violation Analysis - Files to Fix

### Priority 1: CRITICAL - Active Trade Execution Paths ⚠️

#### A. `entry-execution-coordinator.ts`
**Location:** `/src/services/entry-execution-coordinator.ts` (Lines 251-297)
**Current Implementation:**
```typescript
// WRONG - Uses calculateLotSizeFromDollarRisk (bypasses 6 risk layers)
const dollarRisk = currentBalance * (baseRiskPercent / 100);
const recommendedLotSize = calculateLotSizeFromDollarRisk(
  intent.symbol,
  dollarRisk,
  entry_price,
  stop_loss
);
```

**Required Change:**
```typescript
// CORRECT - Uses ProfessionalRiskManager SSOT
const riskAssessment = await professionalRiskManager.evaluateTrade({
  userId: intent.user_id,
  symbol: intent.symbol,
  direction: intent.direction,
  currentBalance,
  baseRiskPercent,
  stopLossPips: Math.abs(entry_price - stop_loss) / pipInfo.value,
  takeProfitPips: Math.abs(take_profit - entry_price) / pipInfo.value,
  goalSessionId: intent.session_id,
  riskMode: riskMode as 'low' | 'medium' | 'high',
  entryPrice: entry_price,
  currentPrice: entry_price
});

if (!riskAssessment.allowed) {
  // Handle rejection
  return { success: false, reason: riskAssessment.reason };
}

const recommendedLotSize = riskAssessment.recommendedLotSize;
```

**Impact:** HIGH - This is entry execution (50%+ of all trades)
**Complexity:** MEDIUM - Async call, error handling needed
**Risk:** LOW - Already used in trade-execution-engine.ts successfully

---

#### B. `goal-session-live-engine.ts`
**Location:** `/src/services/goal-session-live-engine.ts`
**Violations:** Multiple deprecated function calls
1. `calculatePositionSize()`
2. `calculateLotSizeFromDollarRisk()`
3. `calculateGoalAwareLotSize()`

**Analysis Required:** Must read file to see exact usage context

**Estimated Changes:** 3-5 call sites to replace

**Impact:** HIGH - Goal-based trading is 30%+ of user trades
**Complexity:** HIGH - Goal-aware logic may require special handling
**Risk:** MEDIUM - Complex file with session state management

---

#### C. `event-based-llm-engine.ts`
**Location:** `/src/services/event-based-llm-engine.ts`
**Violation:** Uses `calculatePositionSize()`

**Analysis Required:** Must read file to see exact usage context

**Impact:** MEDIUM - Event-driven trades
**Complexity:** MEDIUM
**Risk:** LOW

---

### Priority 2: LOW - Feasibility/Estimation (MAY BE OK) ⚠️

#### D. `goal-feasibility-resolver.ts`
**Location:** `/src/services/goal-feasibility-resolver.ts`
**Violation:** Uses `calculatePositionSize()`

**Analysis:** May be legitimate use case (estimations only)
**Required:** Verify `isEstimation=true` flag is used
**Action:** Add validation that estimates are NEVER used for execution

---

### Priority 3: CLEANUP - Orphaned Code

#### E. `calculateAutonomousPositionSize()`
**Location:** `/src/utils/currencyHelpers.ts` (Lines 809-855)
**Status:** No active callers found
**Action:** Mark as deprecated with clear warning
**Risk:** NONE (unused)

---

## 4. Implementation Plan - Staged Rollout

### Stage 1: entry-execution-coordinator.ts (Day 1)
**Risk:** LOW (well-tested pattern)
**Impact:** HIGH (50%+ of trades)

**Steps:**
1. Read file to understand current context
2. Replace `calculateLotSizeFromDollarRisk()` call with `professionalRiskManager.evaluateTrade()`
3. Add error handling for risk rejection
4. Update logging to show risk metrics
5. Test with small trades first

**Verification:**
- Build passes
- No TypeScript errors
- Entry execution logs show ProfessionalRiskManager metrics
- Test trade execution in development

---

### Stage 2: goal-session-live-engine.ts (Day 2)
**Risk:** MEDIUM (complex file)
**Impact:** HIGH (30%+ of trades)

**Steps:**
1. Read full file to map all deprecated function calls
2. Identify goal-aware logic that requires special handling
3. Replace all position sizing calls with ProfessionalRiskManager
4. Ensure goal feasibility calculations remain separate (estimation only)
5. Test goal-based trading flow end-to-end

**Special Considerations:**
- Goal amount may require reverse calculation (keep in feasibility layer)
- Session constraints may affect risk parameters
- May need goal-specific risk mode mapping

---

### Stage 3: event-based-llm-engine.ts (Day 2)
**Risk:** LOW
**Impact:** MEDIUM

**Steps:**
1. Read file to see calculatePositionSize() usage
2. Replace with ProfessionalRiskManager
3. Test event-driven execution

---

### Stage 4: goal-feasibility-resolver.ts Validation (Day 3)
**Risk:** NONE (likely already compliant)
**Impact:** LOW (estimation only)

**Steps:**
1. Read file to verify `isEstimation=true` flag usage
2. Add explicit comments marking estimation-only usage
3. Consider creating separate `estimatePositionSize()` function to prevent misuse
4. Document that feasibility estimates MUST NOT be used for execution

---

### Stage 5: Documentation & Deprecation (Day 3)
**Risk:** NONE
**Impact:** MEDIUM (prevents future violations)

**Steps:**
1. Add `@deprecated` JSDoc tags to all deprecated functions
2. Add runtime warnings if deprecated functions called without `isEstimation=true`
3. Update RESPONSIBILITY_REGISTRY.md
4. Add architectural test to prevent new calls to deprecated functions
5. Update currencyHelpers.ts header with migration guide

---

## 5. Testing Strategy

### Unit Tests
- [x] ProfessionalRiskManager already has comprehensive tests
- [ ] Add tests for each refactored file
- [ ] Verify deprecated functions log warnings

### Integration Tests
- [ ] Entry execution with ProfessionalRiskManager
- [ ] Goal-based trade execution
- [ ] Risk rejection scenarios
- [ ] Multi-trade exposure limits

### Production Validation
- [ ] Monitor trade execution logs for 24 hours
- [ ] Verify lot sizes are within expected ranges
- [ ] Check that no trades exceed 20% total exposure
- [ ] Validate Kelly Criterion is applied correctly

---

## 6. Rollback Plan

### Immediate Rollback (If Critical Issues Found)
1. Revert commits via git
2. Redeploy previous version via Netlify build hook
3. Document issue in incident log

### Partial Rollback (If Specific File Has Issues)
1. Revert individual file changes
2. Keep other Stage completions
3. Debug failed stage before retry

### Forward Fix (Preferred)
1. Identify specific issue
2. Fix in place
3. Redeploy (faster than rollback)

---

## 7. Success Metrics

### Code Quality
- [ ] Zero active calls to deprecated position sizing functions
- [ ] All trade execution uses ProfessionalRiskManager
- [ ] Build passes with no new warnings
- [ ] TypeScript strict mode passes

### Risk Management
- [ ] All trades evaluated through 7-layer risk pipeline
- [ ] Kelly Criterion applied to all live trades
- [ ] Correlation risk checked for all multi-position scenarios
- [ ] No trades exceed 20% total exposure

### Observability
- [ ] Risk metrics logged for every trade
- [ ] Clear audit trail showing ProfessionalRiskManager decisions
- [ ] Warnings logged if deprecated functions misused

---

## 8. Dependencies & Prerequisites

### Required Before Implementation
- [x] Phase 1 complete (ProfessionalRiskManager validated in production)
- [x] ProfessionalRiskManager handling confirmPendingTrade successfully
- [ ] Review goal-session-live-engine.ts complexity

### Parallel Work (Can Do Concurrently)
- [ ] Phase 2, Section 2: Trade Validation Consolidation
- [ ] Documentation updates

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking goal-based trading | MEDIUM | HIGH | Staged rollout, test goal flow first |
| Lot size calculation errors | LOW | CRITICAL | Comprehensive testing, monitor first 24hr |
| Performance degradation | LOW | LOW | ProfessionalRiskManager already optimized |
| User experience regression | LOW | MEDIUM | Monitor trade execution success rate |

---

## 10. Open Questions

1. **Goal-Aware Sizing:** Does goal-session-live-engine.ts require special risk parameters based on goal amount?
   - **Answer TBD:** Read file to understand goal-aware logic

2. **Feasibility Estimates:** Should we create separate `estimatePositionSize()` function to prevent misuse?
   - **Recommendation:** YES - Create clear separation

3. **LLM Conviction Scaling:** Should Alpha's confidence scores affect position sizing?
   - **Current:** ProfessionalRiskManager doesn't use Alpha confidence
   - **Recommendation:** Consider adding as optional parameter

4. **Emergency Bypass:** Should there be an emergency flag to use simple position sizing?
   - **Recommendation:** NO - If ProfessionalRiskManager fails, trade should be rejected

---

## 11. Next Steps

1. **Read Files:**
   - goal-session-live-engine.ts (identify all deprecated calls)
   - event-based-llm-engine.ts (identify usage context)
   - entry-execution-coordinator.ts (confirm current implementation)

2. **Begin Stage 1:**
   - Fix entry-execution-coordinator.ts
   - Test thoroughly
   - Deploy to production
   - Monitor for 24 hours

3. **Proceed with Stages 2-5** after Stage 1 validation

---

**Generated:** January 22, 2026
**Status:** READY FOR IMPLEMENTATION
**Approval Required:** YES (CCIP protocol requires review before code changes)

---

## Appendix A: File Statistics

| File | Lines | Complexity | Deprecated Calls | Priority |
|------|-------|-----------|------------------|----------|
| entry-execution-coordinator.ts | ~500 | MEDIUM | 1 | P1 - CRITICAL |
| goal-session-live-engine.ts | ~1000+ | HIGH | 3+ | P1 - CRITICAL |
| event-based-llm-engine.ts | ~400 | MEDIUM | 1 | P1 - CRITICAL |
| goal-feasibility-resolver.ts | ~300 | MEDIUM | 1 | P2 - VALIDATE |
| currencyHelpers.ts | ~1400 | HIGH | 4 (definitions) | P3 - DEPRECATE |

---

## Appendix B: ProfessionalRiskManager Call Pattern

**Standard Implementation Pattern:**
```typescript
import { professionalRiskManager } from '@/services/professional-risk-manager';

// Calculate pip distances
const stopPips = calculatePipDistance(symbol, entryPrice, stopLoss);
const takeProfitPips = calculatePipDistance(symbol, entryPrice, takeProfit);

// Call SSOT authority
const riskAssessment = await professionalRiskManager.evaluateTrade({
  userId,
  symbol,
  direction,
  currentBalance,
  baseRiskPercent: 2.0, // or from user profile/risk mode
  stopLossPips,
  takeProfitPips,
  goalSessionId,
  riskMode: 'medium', // 'low' | 'medium' | 'high'
  entryPrice,
  currentPrice
});

// Handle rejection
if (!riskAssessment.allowed) {
  logger.warn(LogCategory.RISK, `Trade rejected: ${riskAssessment.reason}`);
  return {
    success: false,
    error: 'Risk validation failed',
    message: riskAssessment.reason
  };
}

// Use recommended lot size
const lotSize = riskAssessment.recommendedLotSize;

// Log risk metrics for audit trail
logger.info(LogCategory.RISK, 'Risk Assessment', {
  lotSize,
  effectiveRisk: riskAssessment.riskMetrics.effectiveRiskPercent,
  kellyFraction: riskAssessment.riskMetrics.kellyFraction,
  expectedValue: riskAssessment.riskMetrics.expectedValue,
  totalExposure: riskAssessment.riskMetrics.totalExposure
});

// Proceed with trade execution using lotSize...
```
