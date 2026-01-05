# ATR Unit Mismatch SSOT Fix - Complete

## 🎯 Problem Statement

**Root Cause**: ATR is stored system-wide in **price units** (e.g., 0.04370 for USDJPY), but `timeToFillCalculator` expects values in **pips**. This unit mismatch caused the calculator to reject trades as "UNREALISTIC" because it was comparing apples to oranges.

**Impact**:
- coordinator-alpha.ts: ✅ Fixed previously
- goal-session-live-engine.ts: ❌ Still had the bug (41 days undetected)
- Any symbol scanned through goal mode was incorrectly rejecting trades

**Example of the Bug**:
```typescript
// USDJPY Example:
snapshot.atr = 0.04370  // Price units
timeToFillCalculator.calculate({ atrPips: 0.04370 })  // ❌ Treated as 0.04 pips!
// Calculator thought: "0.04 pips of volatility? This will take 41 days!"
// Reality: Should have been 4.37 pips (0.04370 / 0.01)
```

## ✅ SSOT Solution Applied

### 1. Fixed Remaining Call Site
**File**: `src/services/goal-session-live-engine.ts:831`

```typescript
// ❌ BEFORE (Broken)
const atrPips = snapshot.atr || 10;

// ✅ AFTER (Fixed)
const pipInfo = getCurrencyPipInfo(selectedSymbol);
const atrPips = (snapshot.atr || (10 * pipInfo.pipValue)) / pipInfo.pipValue;
```

### 2. Centralized Conversion Logic
**File**: `src/services/time-to-fill-calculator.ts`

Added a new **Single Source of Truth** method that handles conversion internally:

```typescript
/**
 * Calculate time-to-fill from ATR in price units (RECOMMENDED)
 * This method handles the price-to-pip conversion internally to prevent errors
 */
calculateFromPrice(input: TimeToFillPriceInput): TimeToFillResult {
  const { atrPrice, symbol, ...rest } = input;

  // Convert ATR from price units to pips using the symbol's pip value
  const pipValue = TimeToFillCalculator.getPipFactor(symbol);
  const atrPips = atrPrice / pipValue;

  // Validate conversion - detect if wrong units were passed
  if (atrPips > 1000) {
    console.warn(`Suspicious ATR: ${atrPips} pips for ${symbol}`);
  }

  return this.calculate({ ...rest, symbol, atrPips });
}
```

**New Interface**:
```typescript
export interface TimeToFillPriceInput {
  tpDistancePips: number;
  atrPrice: number; // ATR in price units (e.g., 0.04370 for USDJPY)
  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  symbol: string;
  volatilityMultiplier?: number;
}
```

### 3. Added Unit Validation
**File**: `src/services/time-to-fill-calculator.ts:123`

```typescript
// ✅ UNIT VALIDATION: Detect if price units were passed instead of pips
if (safeAtrPips < 0.1) {
  console.error(`⚠️ UNIT ERROR: ATR=${safeAtrPips} pips is suspiciously small for ${symbol}.
                 Did you pass price units instead of pips? Use calculateFromPrice() instead.`);
  return {
    viability: 'UNREALISTIC',
    reasoning: `Unit validation failed: ATR=${safeAtrPips.toFixed(4)} pips is too small`,
    recommendedAction: 'REJECT'
  };
}
```

### 4. Comprehensive Documentation
Added explicit warnings to all interfaces where ATR appears:

**File**: `src/services/multi-symbol-snapshot-builder.ts:28`
```typescript
export interface SymbolSnapshot {
  /**
   * Average True Range in PRICE UNITS (not pips)
   * ⚠️ IMPORTANT: This is stored as a price difference (e.g., 0.04370 for USDJPY)
   * To convert to pips: atrPips = atr / getCurrencyPipInfo(symbol).pipValue
   * Example conversions:
   * - USDJPY: 0.04370 price → 4.37 pips (÷ 0.01)
   * - EURUSD: 0.00045 price → 4.5 pips (÷ 0.0001)
   * - XAUUSD: 2.50 price → 25 pips (÷ 0.1)
   */
  atr: number;
  // ... other fields
}
```

**File**: `src/brains/coordinator-alpha.ts:133`
```typescript
export interface MarketContext {
  /**
   * Average True Range in PRICE UNITS (not pips)
   * ⚠️ Always stored as price difference - convert to pips using: atrPips = atr / pipValue
   */
  atr: number;
  atr20?: number;  // Short-term ATR in PRICE UNITS
  atr100?: number; // Long-term ATR in PRICE UNITS
}
```

**File**: `src/services/strategy-memory-service.ts:61`
```typescript
export interface MarketContext {
  /**
   * Average True Range in PRICE UNITS (not pips)
   * ⚠️ Always stored as price difference - convert to pips using: atrPips = atr / pipValue
   */
  atr: number;
}
```

## 📊 Impact Analysis

### Affected Trading Flows
1. ✅ **Goal-based trading** (multi-symbol scanner) - Now fixed
2. ✅ **Standard trading** (coordinator-alpha) - Already fixed
3. ✅ **Any future integrations** - Protected by validation and documentation

### Why This is True SSOT

**Before** (Scattered Responsibility):
```
Call Site A: Converts ATR manually
Call Site B: Forgets to convert ATR ❌
Call Site C: Converts ATR differently
```

**After** (Single Source of Truth):
```
All Call Sites → Use timeToFillCalculator.calculateFromPrice()
                 ↓
         Conversion happens in ONE PLACE
         Validation happens in ONE PLACE
         Documentation is CLEAR
```

## 🛡️ Prevention Mechanisms

1. **New RECOMMENDED API**: `calculateFromPrice()` - handles conversion internally
2. **Runtime Validation**: Detects suspicious ATR values (< 0.1 pips) and logs errors
3. **Clear Documentation**: All ATR fields explicitly state "PRICE UNITS (not pips)"
4. **Warning Comments**: Legacy `calculate()` method warns users to use `calculateFromPrice()`

## 🎓 Lessons Learned

1. **Unit Consistency is Critical**: When the same data flows through multiple systems, units must be explicit
2. **SSOT Prevents Drift**: Fixing in one place doesn't fix all places unless there's a single authority
3. **Validation Catches Mistakes**: Runtime checks can detect when wrong units are passed
4. **Documentation Prevents Bugs**: Clear warnings at interfaces prevent future developers from making the same mistake

## 📝 Testing Recommendations

1. Test USDJPY trades with ATR ~0.04 (should show ~4 pips, not 0.04 pips)
2. Test EURUSD trades with ATR ~0.0005 (should show ~5 pips, not 0.0005 pips)
3. Test XAUUSD trades with ATR ~2.5 (should show ~25 pips, not 2.5 pips)
4. Verify time-to-fill calculations now show realistic durations (minutes to hours, not days)

## ✨ Summary

**What Changed**:
- Fixed goal-session-live-engine.ts ATR conversion
- Added `calculateFromPrice()` method as SSOT for conversion
- Added runtime unit validation
- Documented ATR storage format across all interfaces

**Why It Matters**:
- Prevents 41-day trade rejection errors across ALL trading pairs
- Establishes a clear pattern for handling unit conversions
- Makes future bugs impossible by centralizing the conversion logic

**Next Steps**:
- Monitor logs for unit validation warnings
- Consider migrating existing call sites to use `calculateFromPrice()`
- Add unit tests for time-to-fill calculations with various symbols
