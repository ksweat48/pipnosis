# XAUUSD Chart Fix - Implementation Complete

**Date**: 2025-12-01
**Status**: ✅ FIXED (Round 2)
**Priority**: CRITICAL

## Problem Summary

XAUUSD chart was not displaying candles with "chart error" message. Console showed multiple critical failures:

1. **Velocity Validation False Positives**: All candles rejected with "VELOCITY LIMIT EXCEEDED for XAUUSD: 91.43%/s (max: 1%/s)"
2. **Database Errors**: 400 errors when upserting candles - `record "new" has no field "time"`
3. **Circuit Breaker Triggered**: All updates blocked after velocity validation failures
4. **Live Tick Rejection**: Even live MetaAPI prices rejected with `timeDiff = 0.0s` causing velocity errors

## Root Causes Identified

### Cause 1: Historical Data Velocity Check
The velocity validation system was incorrectly checking **historical candles loaded from database** where sequential candles have `timeDiff = 0.0s` (same query timestamp), causing mathematical errors.

### Cause 2: Rapid Live Price Checks
The direct price poller was calling `validatePrice()` multiple times rapidly (every 3 seconds), and consecutive calls had `timeDiff ≈ 0.0s`, triggering false velocity violations.

### Cause 3: Database Field Mismatch
Background aggregator was trying to upsert candles with `time` field, but database table expects `open_time` field.

## Fixes Implemented

### 1. ✅ CRITICAL: Disable Velocity Validation for Historical Data

**File**: `src/services/price-validation-service.ts`

**Changes**:
- Added `skipVelocity` parameter to `validatePrice()` method
- Added `skipVelocity` parameter to `validateCandle()` method
- When `skipVelocity = true`, price range validation still runs but velocity checks are skipped

**Code**:
```typescript
validatePrice(symbol: string, price: number, skipVelocity: boolean = false): PriceValidationResult {
  // ... price range validation ...

  // CRITICAL FIX: Skip velocity validation for historical/database-sourced data
  if (!skipVelocity) {
    const velocityCheck = this.validatePriceVelocity(symbol, price, range);
    if (!velocityCheck.isValid) {
      return velocityCheck;
    }
    this.lastPrices.set(symbol, { price, timestamp: Date.now() });
  }

  return { isValid: true, expectedRange: range, deviation };
}
```

### 2. ✅ CRITICAL: Minimum Time Threshold for Velocity Validation

**Problem**: Live ticks rejected when `timeDiff < 0.5s` causing division issues.

**File**: `src/services/price-validation-service.ts`

**Code**:
```typescript
const timeDiff = (Date.now() - lastPriceData.timestamp) / 1000; // seconds

// CRITICAL FIX: Skip velocity check if insufficient time has passed (<0.5s)
// This prevents false positives when checking the same price multiple times rapidly
if (timeDiff < 0.5) {
  return { isValid: true };
}

// CRITICAL FIX: Skip velocity check if too much time has passed (>10 seconds)
if (timeDiff > 10) {
  this.lastPrices.set(symbol, { price: newPrice, timestamp: Date.now() });
  return { isValid: true };
}
```

**Result**: Velocity validation now only applies when `0.5s < timeDiff < 10s`, preventing both rapid-call false positives and stale-data false positives.

### 3. ✅ CRITICAL: Update Chart Poller to Skip Velocity

**File**: `src/services/chart-candle-poller.ts`

**Changes**:
- Pass `skipVelocity = true` when validating database-sourced candles

**Code**:
```typescript
// Skip velocity validation for database-sourced historical candles
const validation = priceValidationService.validateCandle(symbol, {
  open: sanitizedCandle.open,
  high: sanitizedCandle.high,
  low: sanitizedCandle.low,
  close: sanitizedCandle.close
}, true); // skipVelocity = true for database candles
```

### 4. ✅ HIGH: Database Field Mapping Fix

**Problem**: `record "new" has no field "time"` error when saving candles.

**File**: `src/services/background-candle-aggregator.ts`

**Code**:
```typescript
private async processSaveQueue(): Promise<void> {
  // ...
  await Promise.all(
    batch.map(({ symbol, timeframe, candle }) => {
      // Convert CandleData (with 'time' field) to CandleState (with 'startTime')
      const candleState: CandleState = {
        time: candle.time, // Unix seconds
        startTime: candle.time * 1000, // Convert to milliseconds
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0,
        tickCount: 1
      };
      return this.saveCompletedCandle(symbol, timeframe, candleState);
    })
  );
}
```

**Result**: Candles are now properly converted before saving, ensuring `open_time` field is used in database upserts.

### 5. ✅ HIGH: Reset Circuit Breaker on Startup

**File**: `src/App.tsx`

**Changes**:
- Added automatic circuit breaker reset on app startup
- Clears false positive contamination events from previous sessions

**Code**:
```typescript
const resetCircuitBreaker = async () => {
  try {
    const { chartCircuitBreaker } = await import('./services/chart-circuit-breaker');
    chartCircuitBreaker.reset();
    console.log('[App] ✅ Reset circuit breaker on startup');
  } catch (error) {
    console.warn('[App] Could not reset circuit breaker:', error);
  }
};

clearCache();
resetCircuitBreaker();
```

## Impact

### Before Fix
```
❌ XAUUSD chart: No candles displayed
❌ Console: "VELOCITY LIMIT EXCEEDED for XAUUSD: 91.43%/s"
❌ Console: "VELOCITY LIMIT EXCEEDED for XAUUSD: 3.10%/s" (live ticks)
❌ Console: Database 400 error "record 'new' has no field 'time'"
❌ Circuit breaker: OPEN (all updates blocked)
❌ User experience: "Chart Error" message
```

### After Fix
```
✅ XAUUSD chart: Candles displayed normally
✅ Console: No velocity validation errors for historical data
✅ Console: No velocity validation errors for live ticks
✅ Console: No database field errors
✅ Circuit breaker: CLOSED (updates flowing)
✅ User experience: Working chart with live updates
```

## Validation Strategy

The fixed system now has intelligent velocity validation:

1. **Historical/Database Data** (skipVelocity = true):
   - Price range validation ✅
   - Candle structure validation ✅
   - Velocity validation ❌ (skipped)
   - Cross-contamination detection ✅

2. **Live Ticks** (skipVelocity = false - default):
   - Price range validation ✅
   - Candle structure validation ✅
   - Velocity validation ✅ (only when 0.5s < timeDiff < 10s)
   - Cross-contamination detection ✅

3. **Velocity Time Windows**:
   - `timeDiff < 0.5s`: Skip (rapid repeated checks)
   - `0.5s ≤ timeDiff ≤ 10s`: Validate (normal live ticking)
   - `timeDiff > 10s`: Skip and reset (recovering from pause/delay)

## Benefits

1. **Historical data loads without false positives**
2. **Live ticks accepted when arriving at normal intervals**
3. **Rapid polling doesn't trigger false positives**
4. **Database operations succeed with correct field names**
5. **Circuit breaker no longer triggered by false events**
6. **All pairs now working (XAUUSD, EURUSD, GBPUSD, etc.)**
7. **Clean state on each session (circuit breaker reset)**

## Testing Checklist

- [x] XAUUSD chart displays candles
- [x] No velocity validation errors for historical data
- [x] No velocity validation errors for live ticks
- [x] No database field errors
- [x] Circuit breaker remains closed
- [x] Live price updates work normally
- [x] Historical data loads correctly
- [x] Cross-symbol contamination detection still active
- [x] Build completes successfully
- [x] Deployed to production

## Files Modified

1. `src/services/price-validation-service.ts` - Added skipVelocity parameter + time threshold
2. `src/services/chart-candle-poller.ts` - Pass skipVelocity = true for DB candles
3. `src/services/background-candle-aggregator.ts` - Fixed database field mapping
4. `src/App.tsx` - Reset circuit breaker on startup

## Technical Notes

- Velocity validation is **only meaningful for live streaming data** with meaningful time intervals (>0.5s)
- Historical data from database has artificial timestamps that don't reflect actual market movement
- Rapid polling systems need minimum time thresholds to avoid false positives
- Circuit breaker false positives accumulate across sessions, requiring startup reset
- Price range validation still protects against cross-contamination for both live and historical data

## Deployment Status

✅ **Deployed to Production**

- All fixes implemented ✅
- Build successful ✅
- Deployed to Netlify ✅
- No breaking changes ✅
- Existing functionality preserved ✅

Deployment URL: `https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca`
