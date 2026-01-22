# Phase 2, Section 2: Trade Validation Consolidation Plan

**Status:** PLANNING → READY FOR IMPLEMENTATION
**Priority:** CRITICAL - Multiple layers duplicating validation logic
**Estimated Duration:** 2-3 days
**CCIP Stage:** System Map Complete → Logic Contract → Implementation

---

## Executive Summary

Trade validation logic is **highly fragmented** across **14 distinct implementations** with **6 critical duplicates** of Stop Loss/Take Profit direction validation. The designated SSOT (`TradeValidationService`) exists but is **only used in 1 file** out of the entire codebase.

**Current State:**
- TradeValidationService exists as designated SSOT
- Only position-service.ts uses it correctly
- 6 files duplicate core SL/TP validation logic
- 8 files implement independent validation
- No enforcement of SSOT usage

**Goal:** Consolidate all trade validation to use `TradeValidationService` as the Single Source of Truth, eliminating 6 critical duplicates and establishing clear validation authority hierarchy.

---

## 1. System Map - Current State

### Single Source of Truth (SSOT) ✅

**File:** `/src/services/trade-validation-service.ts`
**Status:** Designated SSOT, but UNDERUTILIZED (only 1 caller)

**Key Methods:**
```typescript
validateTrade(params: TradeParams): TradeValidationResult
validateOrThrow(params: TradeParams): void
isValid(params: TradeParams): boolean
autoCorrectLevels(params: TradeParams): TradeParams
```

**Validations Performed:**
- Symbol validation (required, non-empty)
- Direction validation ('buy' or 'sell')
- Price validation (entry/SL/TP > 0)
- **SL/TP Direction Logic** (Lines 60-91):
  - BUY: SL < entry, TP > entry
  - SELL: SL > entry, TP < entry
- Risk/Reward ratio (0.5-10 range)
- Lot size (0.01-100 range)
- Price range (0.0001-1000000)

**Export:** `export const tradeValidationService = new TradeValidationService();`

**Current Usage:**
- ✅ `position-service.ts` (Line 57) - ONLY file using it correctly

---

### Critical Duplicates ❌ (MUST FIX)

#### 1. `/src/governance/validation-gateway.ts` (Lines 129-144)
**Severity:** CRITICAL - Governance layer should delegate to SSOT
**Duplicate:** Exact same SL/TP direction logic
**Method:** `validateTradeRequest(request: TradeRequest)`
**Impact:** HIGH - Entry point for all trade requests

**Current Code:**
```typescript
if (request.direction === 'BUY') {
  if (request.stopLoss >= request.entry) {
    errors.push('Stop loss must be below entry for BUY');
  }
  if (request.takeProfit <= request.entry) {
    errors.push('Take profit must be above entry for BUY');
  }
} else {
  if (request.stopLoss <= request.entry) {
    errors.push('Stop loss must be above entry for SELL');
  }
  if (request.takeProfit >= request.entry) {
    errors.push('Take profit must be below entry for SELL');
  }
}
```

---

#### 2. `/src/services/safety-enforcer.ts` (Lines 84-98)
**Severity:** CRITICAL - Final safety layer duplicates core logic
**Duplicate:** SL/TP direction + auto-correction logic
**Method:** `enforceDecisionSafety(decision, balance, openTrades)`
**Additional:** Also validates R:R ratio, position size, margin, daily drawdown

**Current Code:**
```typescript
// BUY checks
if (decision.direction === 'buy') {
  if (decision.stopLoss >= decision.entry) {
    violations.push('SL must be below entry for BUY');
  }
  if (decision.takeProfit <= decision.entry) {
    violations.push('TP must be above entry for BUY');
  }
}
// SELL checks
else if (decision.direction === 'sell') {
  if (decision.stopLoss <= decision.entry) {
    violations.push('SL must be above entry for SELL');
  }
  if (decision.takeProfit >= decision.entry) {
    violations.push('TP must be below entry for SELL');
  }
}
```

**Auto-Adjustment Logic (Lines 122-146):**
```typescript
// Auto-adjust TP to meet minimum R:R ratio
const currentRR = rrRatio.ratio;
if (currentRR < MIN_RISK_REWARD_RATIO) {
  const adjustedTP = calculateMinimumTP(entry, stopLoss, direction);
  // ... auto-correction
}
```

---

#### 3. `/src/services/mandatory-safety-validator.ts` (Lines 462-475)
**Severity:** CRITICAL - Only allowed blocker duplicates logic
**Duplicate:** Exact same SL/TP direction validation
**Method:** `validateDecisionFormat(decision)`
**Additional:** NaN checks, non-finite checks, negative value checks, decimal precision

**Current Code:**
```typescript
// BUY
if (decision.direction === 'buy') {
  if (decision.stopLoss >= decision.entry) {
    return { valid: false, reason: 'SL must be below entry for BUY' };
  }
  if (decision.takeProfit <= decision.entry) {
    return { valid: false, reason: 'TP must be above entry for BUY' };
  }
}
// SELL
else {
  if (decision.stopLoss <= decision.entry) {
    return { valid: false, reason: 'SL must be above entry for SELL' };
  }
  if (decision.takeProfit >= decision.entry) {
    return { valid: false, reason: 'TP must be below entry for SELL' };
  }
}
```

---

#### 4. `/src/services/risk-preflight-gate.ts` (Lines 86-128)
**Severity:** CRITICAL - Pre-flight gate duplicates validation
**Duplicate:** SL/TP direction validation
**Method:** `checkEligibility(input: ExecutionEligibilityInput)`
**Additional:** ATR-based SL distance, R:R ratio, exposure limits

**Current Code:**
```typescript
// BUY SL
if (input.direction === 'BUY' && input.stopLoss >= input.entry) {
  return { approved: false, reason: 'SL must be below entry for BUY' };
}
// BUY TP
if (input.direction === 'BUY' && input.takeProfit <= input.entry) {
  return { approved: false, reason: 'TP must be above entry for BUY' };
}
// SELL SL
if (input.direction === 'SELL' && input.stopLoss <= input.entry) {
  return { approved: false, reason: 'SL must be above entry for SELL' };
}
// SELL TP
if (input.direction === 'SELL' && input.takeProfit >= input.entry) {
  return { approved: false, reason: 'TP must be below entry for SELL' };
}
```

---

#### 5. `/src/brains/omega/hallucination.ts` (Lines 64-76)
**Severity:** HIGH - Omega-9 safety layer duplicates logic
**Duplicate:** SL/TP direction validation
**Method:** `validate(input: HallucinationInput)`
**Purpose:** Detect mathematical hallucinations in Alpha decisions

**Current Code:**
```typescript
// BUY
if (input.direction === 'BUY') {
  if (input.stopLoss >= input.entry) {
    return { isValid: false, reason: 'SL must be below entry for BUY' };
  }
  if (input.takeProfit <= input.entry) {
    return { isValid: false, reason: 'TP must be above entry for BUY' };
  }
}
// SELL
else {
  if (input.stopLoss <= input.entry) {
    return { isValid: false, reason: 'SL must be above entry for SELL' };
  }
  if (input.takeProfit >= input.entry) {
    return { isValid: false, reason: 'TP must be below entry for SELL' };
  }
}
```

---

#### 6. `/src/services/llm-snapshot-builder.ts` (Lines 462-475)
**Severity:** HIGH - LLM response validation duplicates logic
**Duplicate:** SL/TP direction validation
**Purpose:** Validate LLM decisions before snapshot creation

**Current Code:**
```typescript
if (decision.direction === 'buy') {
  if (decision.stopLoss >= decision.entry) {
    return { valid: false, error: 'Invalid SL for BUY' };
  }
  if (decision.takeProfit <= decision.entry) {
    return { valid: false, error: 'Invalid TP for BUY' };
  }
} else {
  if (decision.stopLoss <= decision.entry) {
    return { valid: false, error: 'Invalid SL for SELL' };
  }
  if (decision.takeProfit >= decision.entry) {
    return { valid: false, error: 'Invalid TP for SELL' };
  }
}
```

---

### Supporting Validators (Specialized) ⚠️

**These validators are OK to keep but should delegate core SL/TP checks to TradeValidationService:**

1. **PriceValidationService** - Price range and velocity checks (specialized, complementary)
2. **SymbolValidator** - Symbol availability (specialized, complementary)
3. **CreditValidationService** - Balance/credit checks (specialized, complementary)
4. **Alpha-Validation-Service** - Domain-specific soft violation categorization (specialized, complementary)

---

## 2. Logic Contract - SSOT Authority Hierarchy

### Validation Authority Hierarchy

```
Level 1 (SSOT - Core Logic):
└─ TradeValidationService
   ├─ SL/TP direction validation (BUY/SELL logic)
   ├─ Price validation (> 0 checks)
   ├─ Risk/Reward ratio validation
   ├─ Symbol/Direction validation
   └─ Lot size validation

Level 2 (Safety - Hard Constraints):
└─ MandatorySafetyValidator (uses Level 1, adds broker/market constraints)
   ├─ NaN/infinite checks
   ├─ Decimal precision
   ├─ Negative value guards
   └─ Delegates SL/TP to TradeValidationService ✅

Level 3 (Risk - Auto-Correction):
└─ SafetyEnforcer (uses Level 1, applies risk adjustments)
   ├─ R:R ratio enforcement (auto-adjusts TP only)
   ├─ Margin requirement checks
   ├─ Daily drawdown limits
   ├─ Exposure limits
   └─ Delegates SL/TP to TradeValidationService ✅

Level 4 (LLM Defense - Hallucination Detection):
└─ Omega-9 Hallucination (uses Level 1, adds LLM-specific checks)
   ├─ Zero distance detection
   ├─ Extreme R:R detection
   ├─ Mathematical consistency
   └─ Delegates SL/TP to TradeValidationService ✅

Level 5 (Governance - Entry Point):
└─ ValidationGateway (uses Level 1, adds SSOT enforcement)
   ├─ SSOT context validation
   ├─ Trade request pre-flight
   ├─ Audit trail logging
   └─ Delegates SL/TP to TradeValidationService ✅

Level 6 (Domain - Alpha Repair):
└─ AlphaValidationService (uses Level 1, categorizes violations)
   ├─ Soft violations (repairable)
   ├─ Hard violations (blockers)
   ├─ Repair guidance generation
   └─ Delegates SL/TP to TradeValidationService ✅
```

### Contract Interface

```typescript
// TradeValidationService (SSOT)
interface TradeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  correctedParams?: TradeParams;
}

// All validators MUST use this pattern:
const validation = tradeValidationService.validateTrade({
  symbol,
  direction,
  entry,
  stopLoss,
  takeProfit,
  lotSize
});

if (!validation.valid) {
  // Handle validation failure
  return { success: false, errors: validation.errors };
}

// Proceed with additional specialized validation (if needed)
```

---

## 3. Implementation Plan - Staged Rollout

### Stage 1: validation-gateway.ts (Day 1 - HIGH PRIORITY)
**Risk:** MEDIUM (entry point for trades)
**Impact:** CRITICAL (all trade requests flow through this)

**Current Issue:**
- Lines 129-144 duplicate SL/TP validation
- Does not use TradeValidationService at all

**Required Change:**
```typescript
// BEFORE (Lines 129-144):
if (request.direction === 'BUY') {
  if (request.stopLoss >= request.entry) {
    errors.push('Stop loss must be below entry for BUY');
  }
  // ... more duplication
}

// AFTER:
const validation = tradeValidationService.validateTrade({
  symbol: request.symbol,
  direction: request.direction,
  entry: request.entry,
  stopLoss: request.stopLoss,
  takeProfit: request.takeProfit,
  lotSize: request.positionSize
});

if (!validation.valid) {
  errors.push(...validation.errors);
}

// Keep governance-specific checks (SSOT context, audit trail)
```

---

### Stage 2: safety-enforcer.ts (Day 1 - HIGH PRIORITY)
**Risk:** MEDIUM (auto-adjusts TP, could affect R:R)
**Impact:** CRITICAL (final safety layer before execution)

**Current Issue:**
- Lines 84-98 duplicate SL/TP validation
- Lines 122-146 auto-adjust TP for R:R

**Required Change:**
```typescript
// BEFORE (Lines 84-98):
if (decision.direction === 'buy') {
  if (decision.stopLoss >= decision.entry) {
    violations.push('SL must be below entry for BUY');
  }
  // ... duplication
}

// AFTER:
const validation = tradeValidationService.validateTrade({
  symbol: decision.symbol,
  direction: decision.direction,
  entry: decision.entry,
  stopLoss: decision.stopLoss,
  takeProfit: decision.takeProfit,
  lotSize: decision.positionSize
});

if (!validation.valid) {
  violations.push(...validation.errors);
}

// Keep SafetyEnforcer-specific logic:
// - Auto-adjust TP for R:R (lines 122-146) - OK to keep
// - Margin checks - OK to keep
// - Exposure limits - OK to keep
```

---

### Stage 3: mandatory-safety-validator.ts (Day 2 - CRITICAL)
**Risk:** HIGH (this is the "only allowed blocker")
**Impact:** CRITICAL (can block all trades)

**Current Issue:**
- Lines 462-475 duplicate SL/TP validation
- Should be using SSOT for core checks

**Required Change:**
```typescript
// BEFORE (Lines 462-475):
if (decision.direction === 'buy') {
  if (decision.stopLoss >= decision.entry) {
    return { valid: false, reason: 'SL must be below entry for BUY' };
  }
  // ... duplication
}

// AFTER:
const validation = tradeValidationService.validateTrade({
  symbol: decision.symbol,
  direction: decision.direction,
  entry: decision.entry,
  stopLoss: decision.stopLoss,
  takeProfit: decision.takeProfit,
  lotSize: decision.positionSize
});

if (!validation.valid) {
  return {
    valid: false,
    reason: validation.errors.join(', '),
    violations: validation.errors
  };
}

// Keep MandatorySafetyValidator-specific checks:
// - NaN/infinite checks (lines 105, 115)
// - Negative value checks (line 125)
// - Decimal precision (line 145)
```

---

### Stage 4: risk-preflight-gate.ts (Day 2 - HIGH PRIORITY)
**Risk:** MEDIUM (pre-flight can reject trades)
**Impact:** HIGH (affects trade eligibility)

**Current Issue:**
- Lines 86-128 duplicate SL/TP validation
- Also duplicates R:R validation

**Required Change:**
```typescript
// BEFORE (Lines 86-128):
if (input.direction === 'BUY' && input.stopLoss >= input.entry) {
  return { approved: false, reason: 'SL must be below entry for BUY' };
}
// ... duplication

// AFTER:
const validation = tradeValidationService.validateTrade({
  symbol: input.symbol,
  direction: input.direction,
  entry: input.entry,
  stopLoss: input.stopLoss,
  takeProfit: input.takeProfit,
  lotSize: input.positionSize
});

if (!validation.valid) {
  return {
    approved: false,
    reason: validation.errors[0],
    violations: validation.errors
  };
}

// Keep risk-preflight-specific checks:
// - ATR-based SL distance (line 84) - OK to keep
// - Exposure limits - OK to keep
```

---

### Stage 5: omega/hallucination.ts (Day 2 - MEDIUM PRIORITY)
**Risk:** LOW (Omega-9 is defense layer)
**Impact:** MEDIUM (can block Alpha decisions)

**Current Issue:**
- Lines 64-76 duplicate SL/TP validation
- Omega-9 should focus on LLM-specific hallucinations

**Required Change:**
```typescript
// BEFORE (Lines 64-76):
if (input.direction === 'BUY') {
  if (input.stopLoss >= input.entry) {
    return { isValid: false, reason: 'SL must be below entry for BUY' };
  }
  // ... duplication
}

// AFTER:
const validation = tradeValidationService.validateTrade({
  symbol: input.symbol,
  direction: input.direction,
  entry: input.entry,
  stopLoss: input.stopLoss,
  takeProfit: input.takeProfit,
  lotSize: 1.0 // Default for validation purposes
});

if (!validation.valid) {
  return {
    isValid: false,
    reason: validation.errors[0],
    hallucinationType: 'geometric_contradiction'
  };
}

// Keep Omega-9 specific checks:
// - Zero distance detection (lines 78-82) - OK to keep
// - Extreme R:R detection (lines 100-106) - OK to keep
```

---

### Stage 6: llm-snapshot-builder.ts (Day 3 - LOW PRIORITY)
**Risk:** LOW (snapshot validation, not execution-critical)
**Impact:** LOW (affects LLM response handling)

**Current Issue:**
- Lines 462-475 duplicate SL/TP validation

**Required Change:**
```typescript
// BEFORE (Lines 462-475):
if (decision.direction === 'buy') {
  if (decision.stopLoss >= decision.entry) {
    return { valid: false, error: 'Invalid SL for BUY' };
  }
  // ... duplication
}

// AFTER:
const validation = tradeValidationService.validateTrade({
  symbol: decision.symbol,
  direction: decision.direction,
  entry: decision.entry,
  stopLoss: decision.stopLoss,
  takeProfit: decision.takeProfit,
  lotSize: decision.positionSize || 1.0
});

if (!validation.valid) {
  return {
    valid: false,
    error: validation.errors.join(', ')
  };
}
```

---

## 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking validation logic | LOW | CRITICAL | Test all validators with same test suite |
| Auto-correction conflicts | MEDIUM | HIGH | Clarify TP auto-adjustment ownership |
| Performance degradation | LOW | LOW | TradeValidationService is already fast |
| Validation order issues | MEDIUM | HIGH | Document validation layer hierarchy |
| Breaking Omega-9 defense | LOW | MEDIUM | Keep LLM-specific checks separate |

---

## 5. Testing Strategy

### Unit Tests
- [ ] Test TradeValidationService with all validators
- [ ] Verify each validator still catches same violations
- [ ] Test edge cases (zero distance, extreme R:R, etc.)

### Integration Tests
- [ ] Test full validation pipeline (Gateway → Safety → Preflight)
- [ ] Verify Omega-9 still blocks hallucinations
- [ ] Test auto-correction logic in SafetyEnforcer

### Production Validation
- [ ] Monitor validation rejection rates (should stay same)
- [ ] Check that no valid trades are blocked
- [ ] Verify error messages are still user-friendly

---

## 6. Success Metrics

### Code Quality
- [ ] 6 files updated to use TradeValidationService
- [ ] Zero duplicate SL/TP validation logic
- [ ] Clear validation hierarchy documented
- [ ] All validators tested

### Validation Coverage
- [ ] All SL/TP direction checks use SSOT
- [ ] Specialized validators keep domain-specific logic
- [ ] No validation gaps created

### Performance
- [ ] No increase in validation time
- [ ] Same number of validations performed
- [ ] Improved maintainability (single update point)

---

## 7. Rollback Plan

### Immediate Rollback (If Critical Issues)
```bash
git revert <commit-hash>
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

### Partial Rollback (If Specific Validator Breaks)
Revert individual files while keeping others deployed

### Forward Fix (Preferred)
Identify and fix specific issue in TradeValidationService

---

## 8. Open Questions

### 1. Auto-Correction Philosophy
**Question:** Should SafetyEnforcer auto-adjust TP, or should it reject and ask Alpha to revise?

**Current:** SafetyEnforcer auto-adjusts TP to meet minimum R:R
**Philosophy:** "Engine validates, Alpha decides"
**Conflict:** Auto-adjustment violates Alpha's authority

**Options:**
- A) Keep auto-adjustment (pragmatic)
- B) Remove auto-adjustment, reject trade (philosophical)
- C) Auto-adjust with Alpha notification

**Recommendation:** Option A (keep auto-adjustment) - it's working well in production

### 2. Validation Layer Order
**Question:** Should validation happen top-down or bottom-up?

**Current:** Each layer validates independently
**Proposed:** Validate in hierarchy (SSOT → Safety → Risk → Domain)

**Recommendation:** Top-down (SSOT first) - fail fast on basic violations

### 3. TradeValidationService Scope
**Question:** Should TradeValidationService include margin/exposure checks?

**Current:** Only validates SL/TP/prices/R:R
**Alternative:** Add margin/balance validation too

**Recommendation:** Keep focused on trade geometry - let specialized validators handle balance/margin

---

## 9. Dependencies & Prerequisites

### Required Before Implementation
- [ ] Phase 2 Section 1 complete (position sizing)
- [ ] TradeValidationService tested and working
- [ ] Test suite created for validators

### Parallel Work (Can Do Concurrently)
- [ ] Phase 2 Section 3 (Risk Calculation Consolidation)
- [ ] Documentation updates

---

## 10. Next Steps

1. **Review Plan** - Get approval for consolidation approach
2. **Create Test Suite** - Shared test cases for all validators
3. **Stage 1 Implementation** - Fix validation-gateway.ts
4. **Stage 2 Implementation** - Fix safety-enforcer.ts
5. **Stages 3-6** - Fix remaining validators
6. **Deploy and Monitor** - Watch for validation issues

---

**Generated:** January 22, 2026
**Status:** READY FOR IMPLEMENTATION
**Approval Required:** YES (CCIP protocol requires review before code changes)

---

## Appendix A: File Statistics

| File | Lines Changed | Complexity | Priority | Risk |
|------|---------------|-----------|----------|------|
| validation-gateway.ts | ~20 | LOW | P1 | MEDIUM |
| safety-enforcer.ts | ~30 | MEDIUM | P1 | MEDIUM |
| mandatory-safety-validator.ts | ~20 | LOW | P1 | HIGH |
| risk-preflight-gate.ts | ~50 | MEDIUM | P2 | MEDIUM |
| omega/hallucination.ts | ~20 | LOW | P2 | LOW |
| llm-snapshot-builder.ts | ~20 | LOW | P3 | LOW |

**Total Lines to Change:** ~160
**Total Files to Modify:** 6

---

## Appendix B: TradeValidationService Standard Pattern

**Import:**
```typescript
import { tradeValidationService } from './trade-validation-service';
```

**Usage Pattern:**
```typescript
const validation = tradeValidationService.validateTrade({
  symbol: params.symbol,
  direction: params.direction,
  entry: params.entry,
  stopLoss: params.stopLoss,
  takeProfit: params.takeProfit,
  lotSize: params.lotSize
});

if (!validation.valid) {
  // Handle validation failure
  logger.error('Trade validation failed:', validation.errors);
  return {
    success: false,
    errors: validation.errors,
    warnings: validation.warnings
  };
}

// Proceed with trade (validation passed)
```

**Error Handling:**
```typescript
// Option 1: Return errors
if (!validation.valid) {
  return { success: false, errors: validation.errors };
}

// Option 2: Throw exception (for critical failures)
tradeValidationService.validateOrThrow(params);

// Option 3: Boolean check (for quick validation)
if (!tradeValidationService.isValid(params)) {
  return false;
}
```
