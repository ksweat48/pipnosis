# Currency Formatting & Database Query Fixes

**Date:** 2026-01-07
**Status:** ✅ COMPLETE

## Issues Fixed

### 1. Currency Formatting Parameter Order Bug (CRITICAL)

**Location:** `src/services/goal-session-live-engine.ts:1177`

**Problem:**
```typescript
// WRONG - Parameters swapped
formatCurrencyPrice(tp1Price, selectedSymbol)
```

The function signature is `formatCurrencyPrice(symbol: string, price: number)`, but it was being called with price first, symbol second. This caused the numeric price value (e.g., `91007.03620689655`) to be passed as the symbol parameter, which then failed when trying to call `.toUpperCase()` on a number.

**Fix:**
```typescript
// CORRECT - Symbol first, price second
formatCurrencyPrice(selectedSymbol, tp1Price)
formatCurrencyPrice(selectedSymbol, tp2Price)
```

Also added `.toFixed(2)` to the dollar amount displays to prevent floating point display issues.

---

### 2. Missing Defensive Programming in formatCurrencyPrice

**Location:** `src/utils/currencyHelpers.ts:251-274`

**Problem:**
The function had no input validation and would crash if:
- Symbol parameter was not a string (e.g., a number was passed)
- Price parameter was not a valid number (undefined, null, NaN)

**Fix:**
Added comprehensive defensive checks:

```typescript
export function formatCurrencyPrice(
  symbol: string,
  price: number
): string {
  // Defensive guard: Validate symbol parameter
  if (!symbol || typeof symbol !== 'string') {
    console.error('[formatCurrencyPrice] Invalid symbol parameter:', symbol);
    return typeof price === 'number' && !isNaN(price) ? price.toFixed(2) : 'N/A';
  }

  // Defensive guard: Validate price parameter
  if (typeof price !== 'number' || isNaN(price) || price === null || price === undefined) {
    console.error(`[formatCurrencyPrice] Invalid price parameter for ${symbol}:`, price);
    return 'N/A';
  }

  try {
    const pipInfo = getCurrencyPipInfo(symbol);
    return price.toFixed(pipInfo.decimalPlaces);
  } catch (error) {
    console.error(`[formatCurrencyPrice] Error formatting price for ${symbol}:`, error);
    return price.toFixed(2); // Fallback to 2 decimals
  }
}
```

**Benefits:**
- Prevents crashes from invalid inputs
- Logs clear error messages for debugging
- Provides sensible fallbacks
- Maintains system stability even with bad data

---

### 3. Database Query Count Error

**Location:** `src/services/goal-session-live-engine.ts:534-544`

**Problem:**
```typescript
const { data: verifyTrades } = await supabase
  .from('goal_session_trades')
  .select('id', { count: 'exact', head: true })
  .eq('goal_session_id', this.activeSession!)
  .eq('status', 'open');

const dbCount = (verifyTrades as any)?.count || 0;
```

Issues:
1. Using `head: true` with count can cause response structure issues
2. Accessing count from `data` property (incorrect structure)
3. No error handling
4. Type casting `as any` masked the problem

**Fix:**
```typescript
const { count: dbCount, error: countError } = await supabase
  .from('goal_session_trades')
  .select('*', { count: 'exact', head: true })
  .eq('goal_session_id', this.activeSession!)
  .eq('status', 'open');

if (countError) {
  logger.error(LogCategory.AI_TRADING, 'Error querying trade count:', countError);
}

const tradeCount = dbCount || 0;
```

**Benefits:**
- Correctly destructures `count` from response
- Adds error handling and logging
- Removes unsafe type casting
- More explicit variable naming

---

## Testing Recommendations

### Manual Testing
1. Start a goal trading session
2. Trigger a trade with dual TP system
3. Verify console logs show properly formatted prices
4. Verify no "toFixed is not a function" errors
5. Verify trade count queries work correctly

### Expected Console Output
```
[Dual TP] TP1: 1.08456 ($45.50) | TP2: 1.08612 ($125.75)
```

NOT:
```
[Dual TP] TP1: N/A ($91007.03620689655) | TP2: N/A ($...
```

---

## Impact Analysis

### User Impact
- ✅ Fixes crashes when dual TP system calculates targets
- ✅ Prevents database query errors during trade count verification
- ✅ Improves error logging for debugging

### Performance Impact
- ✅ Minimal - only adds validation checks that short-circuit on success
- ✅ Prevents expensive error handling from crashes

### Risk Assessment
- ✅ **LOW RISK** - Changes are defensive and don't alter business logic
- ✅ All changes add safety, don't remove functionality
- ✅ Build completes successfully

---

## Files Modified

1. `src/utils/currencyHelpers.ts` - Added defensive programming
2. `src/services/goal-session-live-engine.ts` - Fixed parameter order and query structure

---

## Verification

Build Status: ✅ **PASSED**
```
✓ built in 28.89s
```

No compilation errors.
No type errors.
All validations passed.

---

## Notes for Future Development

1. **Always use `formatCurrencyPrice(symbol, price)` in that order**
2. Consider adding TypeScript branded types to prevent parameter swapping
3. When using Supabase count queries, always destructure `count` directly
4. All formatting functions should include defensive input validation

---

## Root Cause Analysis

The parameter swap occurred because:
1. Some formatting functions take `price` first (e.g., `formatPositionPrice(price, symbol)`)
2. Others take `symbol` first (e.g., `formatCurrencyPrice(symbol, price)`)
3. No type system protection against this mistake

**Recommendation:** Standardize all formatting functions to take `symbol` first for consistency.
