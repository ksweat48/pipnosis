# Phase 2 - Section 2: Risk Calculation Consolidation Audit

**Date:** 2026-01-20
**Status:** 🔍 AUDIT COMPLETE - REFACTORING NEEDED
**Severity:** HIGH - 15 SSOT violations found

---

## Executive Summary

**Authority (SSOT):** `ProfessionalRiskManager` at `/src/services/professional-risk-manager.ts`

**Violations Found:**
- 3 HIGH severity (bypass authority entirely)
- 8 MEDIUM severity (precalculation or hardcoded values)
- 4 LOW severity (minor duplicates)

**Impact:** Multiple services calculate risk independently, bypassing:
- Volatility adjustments
- Drawdown-based scaling
- Correlation limits
- Kelly Criterion sizing
- EV gating

---

## Authority Analysis: ProfessionalRiskManager

**Location:** `/src/services/professional-risk-manager.ts`

**Legitimate Responsibilities:**
1. Risk percentage calculation with profile-based floors/ceilings (lines 201-217)
2. Volatility-adjusted risk via `volatilityAdjustedRisk` (line 152)
3. Drawdown-based risk scaling via `progressiveRiskScaling` (line 183)
4. Correlation risk limits via `correlationRiskManager` (line 167)
5. Kelly Criterion position sizing (line 106)
6. EV gating validation (line 132)
7. Final lot size calculation with risk multipliers (lines 190-223)
8. Total exposure checking (lines 440-507)

**Correct Architecture:**
- Orchestrates specialized risk sub-services
- Applies risk profile ranges from `risk-strategy-profiles.ts`
- Uses `getRiskPercentage()` as input baseline
- Outputs adjusted risk and recommended lot size

---

## HIGH SEVERITY VIOLATIONS

### 1. goal-scanner.ts - Independent Risk Calculation

**Location:** `/src/services/goal-scanner.ts:807, 910-913`

**Code:**
```typescript
const riskPercent = getRiskPercentage(sessionConfig.risk_mode);

calculateRiskAmount(sessionConfig: SessionConfig): number {
  const balance = sessionConfig.starting_balance;
  const riskPercent = getRiskPercentage(sessionConfig.risk_mode) / 100;
  return balance * riskPercent;
}
```

**Problem:** Calculates risk percentage and dollar risk directly without:
- Volatility adjustments
- Drawdown-based scaling
- Correlation limits
- Kelly Criterion sizing

**Fix Required:** Replace with `professionalRiskManager.evaluateTrade()` call

---

### 2. currencyHelpers.ts - Hardcoded 15% Maximum

**Location:** `/src/utils/currencyHelpers.ts:664-665`

**Code:**
```typescript
if (riskPercentage <= 0 || riskPercentage > 15) {
  throw new Error(`ASSERTION FAILED: riskPercentage must be 0-15% (got ${riskPercentage}%)`);
}
```

**Problem:** Hardcoded 15% maximum instead of using `TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE` (10%)

**Fix Required:** Replace with constant reference

---

### 3. event-based-llm-engine.ts - Hardcoded Risk Mode Map

**Location:** `/src/services/event-based-llm-engine.ts:395-396`

**Code:**
```typescript
const riskModeMap = { low: 3, medium: 5, high: 10 };
const riskPercent = riskModeMap[config.riskMode] || 5;
```

**Problem:** Hardcoded risk percentages (3%, 5%, 10%) bypassing all risk adjustments

**Fix Required:** Replace with `getRiskPercentage()` or ProfessionalRiskManager

---

## MEDIUM SEVERITY VIOLATIONS

### 4. goal-session-live-engine.ts - Precalculation Before Authority

**Location:** `/src/services/goal-session-live-engine.ts:1198-1205`

**Code:**
```typescript
let baseRiskPercent: number;
if (config.dollarRisk) {
  baseRiskPercent = (config.dollarRisk / config.initialBalance) * 100;
} else {
  baseRiskPercent = getRiskPercentage(config.riskMode);
}
```

**Problem:** Converts dollar-to-percent outside authority

**Fix Required:** Move conversion inside ProfessionalRiskManager

---

### 5. goal-feasibility-resolver.ts - Hardcoded 2% Fallback

**Location:** `/src/services/goal-feasibility-resolver.ts:484-485`

**Code:**
```typescript
actualLotSize = (accountBalance * 0.02) / (slPips * dollarPerPipPerLot);
riskPercentUsed = 2.0;
```

**Problem:** Hardcoded `* 0.02` (2% risk)

**Fix Required:** Use `TRADING_CONSTANTS.RISK_PERCENTAGES.DEFAULT_PER_TRADE`

---

### 6. alpha-execution-planner.ts - Hardcoded 3% Risk

**Location:** `/src/services/alpha-execution-planner.ts:432-433`

**Code:**
```typescript
riskPerTrade: context.currentBalance * 0.03,
totalRisk: context.currentBalance * 0.03 * numTrades,
```

**Problem:** Hardcoded `* 0.03` (3% risk)

**Fix Required:** Use `TRADING_CONSTANTS.RISK_PERCENTAGES` or ProfessionalRiskManager

---

### 7. safety-enforcer.ts - Duplicate Constant

**Location:** `/src/services/safety-enforcer.ts:154`

**Code:**
```typescript
const maxPositionSize = context.balance * this.MAX_RISK_PER_TRADE;
```

**Problem:** `this.MAX_RISK_PER_TRADE` should reference `TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE`

**Fix Required:** Replace class constant with centralized constant

---

### 8. mandatory-safety-validator.ts - Hardcoded 5% Daily Loss

**Location:** `/src/services/mandatory-safety-validator.ts:223`

**Code:**
```typescript
const maxDailyLoss = session.max_daily_loss || user.balance * 0.05;
```

**Problem:** Hardcoded `* 0.05` (5%)

**Fix Required:** Use `TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_DAILY_DRAWDOWN`

---

### 9. hybrid-risk-manager.ts - Hardcoded 5% Daily Loss

**Location:** `/src/services/hybrid-risk-manager.ts:422`

**Code:**
```typescript
const maxDailyLoss = currentBalance * 0.05;
```

**Problem:** Hardcoded `* 0.05` (5%)

**Fix Required:** Use `TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_DAILY_DRAWDOWN`

---

### 10. goal-session-live-engine.ts - Hardcoded 5% Maximum

**Location:** `/src/services/goal-session-live-engine.ts:1458`

**Code:**
```typescript
const maxSafeRisk = config.initialBalance * 0.05; // 5% absolute maximum
```

**Problem:** Hardcoded `* 0.05`

**Fix Required:** Use `TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE`

---

## LOW SEVERITY VIOLATIONS

### 11. ai-concurrency-analyzer.ts - Estimation Only

**Location:** `/src/services/ai-concurrency-analyzer.ts:162-166`

**Problem:** Direct `balance * riskPercent` for estimations

**Fix Required:** Document as estimation-only, add comment

---

### 12. kelly-criterion-sizer.ts - Hardcoded 0.5% Minimum

**Location:** `/src/services/kelly-criterion-sizer.ts:87`

**Code:**
```typescript
const minRiskAmount = currentBalance * 0.005; // 0.5% minimum risk
```

**Problem:** Hardcoded `* 0.005`

**Fix Required:** Use `TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE`

---

## Correct SSOT Usage (No Changes Needed)

**Clean Files:**
- ✅ `volatility-adjusted-risk.ts` - Properly integrated
- ✅ `progressive-risk-scaling.ts` - Properly integrated
- ✅ `correlation-risk-manager.ts` - Properly integrated
- ✅ `risk-levels.ts` - Correct SSOT implementation
- ✅ `trading-constants.ts` - Correct SSOT definition
- ✅ `risk-strategy-profiles.ts` - Correct profile definitions

---

## Refactoring Priority

**Phase 1 (Critical - Do First):**
1. goal-scanner.ts - Replace with ProfessionalRiskManager
2. event-based-llm-engine.ts - Remove hardcoded risk map
3. currencyHelpers.ts - Fix 15% hardcoded maximum

**Phase 2 (Important):**
4. goal-session-live-engine.ts - Move dollar-to-percent conversion
5. goal-feasibility-resolver.ts - Replace hardcoded 2%
6. alpha-execution-planner.ts - Replace hardcoded 3%
7. safety-enforcer.ts - Use centralized constant
8. mandatory-safety-validator.ts - Replace hardcoded 5%
9. hybrid-risk-manager.ts - Replace hardcoded 5%

**Phase 3 (Cleanup):**
10. kelly-criterion-sizer.ts - Use constant for minimum
11. ai-concurrency-analyzer.ts - Add estimation comment

---

## Expected Impact

**After Refactoring:**
- All risk calculations flow through ProfessionalRiskManager
- Volatility adjustments applied consistently
- Drawdown-based scaling active everywhere
- Correlation limits enforced
- Kelly Criterion sizing universal
- No hardcoded risk multipliers anywhere

**Benefits:**
- Fix-once-everywhere for risk logic
- Consistent risk management across all flows
- Better protection against oversizing
- Proper drawdown handling
- Portfolio diversification enforced

---

## Next Steps

1. Create PHASE2_SECTION2_RISK_CALCULATION_REFACTORING.md with detailed fixes
2. Refactor HIGH severity violations first
3. Replace all hardcoded risk multipliers with constants
4. Add deprecation warnings where needed
5. Build and verify
6. Deploy Section 2 alongside Section 1

**Estimated Time:** 2-3 hours
**Risk Level:** MEDIUM - Touches critical risk logic
**Testing Required:** Manual verification of risk calculations
