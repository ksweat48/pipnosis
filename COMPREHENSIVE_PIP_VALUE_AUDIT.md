# Comprehensive Pip Value Audit - All Trading Pairs

**Date:** January 8, 2026
**Issue:** Following XAUUSD 100x error, audit ALL pairs for decimal placement consistency
**Scope:** Crypto, Indices, Forex, Metals

## Executive Summary

**CRITICAL ISSUES FOUND:**

1. **Indices (US30, NAS100, SPX500, UK100, GER40):** symbol-registry.ts has WRONG dollarPerPipPerLot
   - Current: dollarPerPipPerLot = 1.0
   - Should be: dollarPerPipPerLot = 100 (matches database and currencyHelpers)
   - Impact: Configuration mismatch, but currencyHelpers SSOT is used so trades are correct

2. **XAGUSD (Silver):** Not handled in currencyHelpers.ts
   - Falls back to standard forex (pipValue = 0.0001, dollarPerPipPerLot = 10)
   - Should be: pipValue = 1.0, dollarPerPipPerLot = 5.0 (per symbol-registry)
   - Impact: XAGUSD trades would have wrong pip calculations if executed

3. **ETHUSD pip calculation:** Database uses v_pip = 1.0, but should be 0.1
   - TypeScript correctly uses 0.1
   - Database function treats ETHUSD like BTCUSD
   - Impact: ETHUSD pip distances are calculated 10x too small in database

## Detailed Audit by Asset Class

### 1. METALS

#### XAUUSD (Gold)
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | 1.0 | 100 | ✅ CORRECT |
| symbol-registry.ts | 0.01 (tick size) | 1.0 | ⚠️ Different purpose |
| DB: calculate_pip_distance | 1.0 | - | ✅ CORRECT |
| DB: calculate_dollar_per_pip | - | 100 | ✅ CORRECT |

**Verdict:** ✅ FIXED (Jan 8, 2026 migration)
**Notes:** Dual pip system intentional - registry = tick size, currencyHelpers = reasoning pip

#### XAGUSD (Silver)
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | ❌ NOT HANDLED | ❌ Falls to forex default (10) | 🚨 BUG |
| symbol-registry.ts | 0.001 (tick size) | 5.0 | ✅ Correct config |
| DB: calculate_pip_distance | 1.0 | - | ⚠️ Uses XAUUSD logic |
| DB: calculate_dollar_per_pip | - | 100 | 🚨 WRONG (should be 5.0) |

**Verdict:** 🚨 CRITICAL - XAGUSD not properly handled
**Impact:** If XAGUSD trades execute, pip calculations will be WRONG
**Fix Required:** Add XAGUSD handling to currencyHelpers and database

### 2. INDICES

#### US30, NAS100, SPX500, UK100, GER40
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | 1.0 | 100 | ✅ CORRECT |
| symbol-registry.ts | 1.0 | 1.0 | 🚨 WRONG |
| DB: calculate_pip_distance | 1.0 (fallback) | - | ⚠️ Not explicit |
| DB: calculate_dollar_per_pip | - | 100 | ✅ CORRECT |

**Verdict:** ⚠️ CONFIG MISMATCH - symbol-registry has wrong value
**Impact:** LOW - currencyHelpers SSOT is used for calculations, so trades are correct
**Fix Required:** Update symbol-registry.ts to match SSOT

**Sample Trade Verification (US30):**
- Trade: 0.1 lots, P&L = -$534.35
- Using currencyHelpers: 0.1 × 100 = $10/pip → 53.4 pips loss ✅ Reasonable
- Using symbol-registry: 0.1 × 1 = $0.10/pip → 5343 pips loss ❌ Unrealistic

### 3. CRYPTO

#### BTCUSD (Bitcoin)
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | 1.0 | 1.0 | ✅ CORRECT |
| symbol-registry.ts | 1.0 | 1.0 | ✅ CORRECT |
| DB: calculate_pip_distance | 1.0 | - | ✅ CORRECT |
| DB: calculate_dollar_per_pip | - | 1.0 | ✅ CORRECT |

**Verdict:** ✅ PERFECT ALIGNMENT

#### ETHUSD (Ethereum)
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | 0.1 | 0.1 | ✅ CORRECT |
| symbol-registry.ts | 0.1 | 0.1 | ✅ CORRECT |
| DB: calculate_pip_distance | 1.0 | - | 🚨 WRONG (treats as BTC) |
| DB: calculate_dollar_per_pip | - | 0.1 | ✅ CORRECT |

**Verdict:** 🚨 CRITICAL - Database pip calculation is 10x wrong
**Impact:** ETHUSD pip distances calculated incorrectly (20 pips shown as 2 pips)
**Fix Required:** Update database calculate_pip_distance to handle ETHUSD separately

**Sample Trade Verification (ETHUSD):**
- Trade: 10 lots, P&L = -$35.85
- Using correct pip value (0.1): $1/pip → 35.85 pips loss ✅ Reasonable
- Using wrong pip value (1.0): $1/pip → 3.585 pips loss ❌ Too small

### 4. FOREX

#### JPY Pairs (USDJPY, EURJPY, GBPJPY, AUDJPY)
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | 0.01 | 10 | ✅ CORRECT |
| symbol-registry.ts | 0.01 | 10 | ✅ CORRECT |
| DB: calculate_pip_distance | 0.01 | - | ✅ CORRECT |
| DB: calculate_dollar_per_pip | - | 10 | ✅ CORRECT |

**Verdict:** ✅ PERFECT ALIGNMENT

#### Standard Forex (EURUSD, GBPUSD, etc.)
| Source | pipValue | dollarPerPipPerLot | Status |
|--------|----------|-------------------|--------|
| currencyHelpers.ts | 0.0001 | 10 | ✅ CORRECT |
| symbol-registry.ts | 0.0001 | 10 | ✅ CORRECT |
| DB: calculate_pip_distance | 0.0001 | - | ✅ CORRECT |
| DB: calculate_dollar_per_pip | - | 10 | ✅ CORRECT |

**Verdict:** ✅ PERFECT ALIGNMENT

## Summary of Issues

| Symbol | Issue | Severity | Impact |
|--------|-------|----------|--------|
| XAUUSD | Was using 0.01 instead of 1.0 | 🟢 FIXED | 100x error - RESOLVED |
| XAGUSD | Not handled in currencyHelpers | 🔴 CRITICAL | Would cause wrong calculations |
| XAGUSD | Database uses 100 instead of 5.0 | 🔴 CRITICAL | 20x error in dollar/pip |
| ETHUSD | Database uses 1.0 instead of 0.1 | 🔴 CRITICAL | 10x error in pip distance |
| Indices | symbol-registry has wrong dollarPerPipPerLot | 🟡 MEDIUM | Config mismatch only |
| BTCUSD | All aligned | ✅ OK | No issues |
| Forex | All aligned | ✅ OK | No issues |

## Required Fixes

### Fix 1: Add XAGUSD Support to TypeScript
**File:** `src/utils/currencyHelpers.ts`
**Change:** Add explicit XAGUSD handling in `getCurrencyPipInfo()`
```typescript
// Add after XAUUSD check
if (normalized === 'XAGUSD' || normalized === 'SILVER') {
  return {
    pipValue: 1.0,            // 1 pip = 1 point (same as gold)
    pipMultiplier: 1,
    decimalPlaces: 3,
    contractSize: 5000,       // 5000 troy ounces per lot
    dollarPerPipPerLot: 5.0,  // $5 per full lot
    symbolType: 'metal'
  };
}
```

### Fix 2: Fix Database ETHUSD Pip Calculation
**File:** Database migration
**Change:** Update `calculate_pip_distance()` to handle ETHUSD separately
```sql
ELSIF v_sym IN ('BTCUSD', 'BTCUSDT') THEN
  v_pip := 1.0; -- Bitcoin: 1 pip = 1 point
ELSIF v_sym IN ('ETHUSD', 'ETHUSDT') THEN
  v_pip := 0.1; -- Ethereum: 1 pip = 0.1 point
```

### Fix 3: Fix Database XAGUSD Dollar Per Pip
**File:** Database migration
**Change:** Update `calculate_dollar_per_pip()` to handle XAGUSD separately
```sql
ELSIF v_sym = 'XAUUSD' THEN
  v_mult := 100; -- Gold: $100 per lot
ELSIF v_sym = 'XAGUSD' THEN
  v_mult := 5; -- Silver: $5 per lot (NOT 100!)
```

### Fix 4: Update symbol-registry Indices
**File:** `src/config/symbol-registry.ts`
**Change:** Update all index symbols dollarPerPipPerLot from 1.0 to 100
```typescript
US30: {
  ...
  dollarPerPipPerLot: 100,  // Was: 1.0
}
// Repeat for NAS100, SPX500, UK100, GER40
```

## Verification Steps

1. Run migration to fix database functions
2. Test XAGUSD trade calculation (if available)
3. Test ETHUSD trade calculation
4. Verify indices trades continue to work correctly
5. Run full test suite on position sizing

## Trade Impact Analysis

**Currently Broken Symbols:**
- XAGUSD: Would be wrong if traded (not currently in use)
- ETHUSD: Pip distances shown incorrectly (affects UI and logging only)

**Fixed Symbols:**
- XAUUSD: Fixed Jan 8, 2026 ✅

**Working Symbols:**
- BTCUSD: Correct ✅
- All Forex: Correct ✅
- All Indices: Correct (currencyHelpers SSOT overrides registry) ✅
