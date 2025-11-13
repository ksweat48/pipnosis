# Chart Data Overlap Fix - Implementation Summary

## Problem Identified

The chart was displaying two separate datasets at different price scales:
- **Bottom**: Small candlesticks at correct prices (around 1.09 for EURUSD)
- **Top**: VWAP/EMA indicator lines at incorrect prices (around 1.15)

### Root Cause

The indicators were being calculated using `allCandles` which combined:
1. `historicalCandles` from the `forex_candles` table (correct data)
2. `currentCandle` aggregated from `realtime_prices` (potentially corrupted data)

When the current candle contained invalid price data (wrong symbol data, stale data, or bad aggregation), the indicators calculated across the full range including the anomalous price, causing the chart to autoscale incorrectly and display indicators far from the actual candlesticks.

## Solution Implemented

### 1. Price Validation System

**File**: `src/services/candle-data-service.ts`

Added `validateCandleAgainstHistorical()` function that:
- Validates new candles against recent historical price ranges
- Checks if price deviation exceeds 10% threshold
- Prevents time-traveling candles (newer candle older than historical)
- Provides detailed logging when anomalies are detected

```typescript
export function validateCandleAgainstHistorical(
  newCandle: CandleData,
  historicalCandles: CandleData[],
  symbol: string
): CandleValidationResult
```

### 2. Enhanced Aggregation Function

**File**: `src/services/candle-data-service.ts`

Updated `aggregatePricesToCurrentCandle()` to:
- Accept optional `historicalCandles` and `symbol` parameters
- Validate aggregated candle before returning
- Return `null` if validation fails instead of returning bad data

### 3. Chart Component Validation

**File**: `src/components/MarketChart.tsx`

Added validation at three critical points:

#### A. Live Updates from Background Aggregator
- Validates candles from `backgroundCandleAggregator` before chart update
- Rejects and logs invalid candles
- Shows warning banner when data quality issues occur

#### B. Initial Chart Load
- Validates the initial current candle before combining with historical data
- Excludes invalid current candle from chart initialization
- Logs price ranges being used for indicators

#### C. Indicator Recalculation
- Validates current candle when indicator visibility changes
- Ensures indicators only calculate from validated data

### 4. Comprehensive Logging

Added detailed logging throughout:
- Price validation results with deviation percentages
- Allowed price ranges vs actual prices
- Candle acceptance/rejection reasons
- Price ranges used for indicator calculations

## How It Works

### Data Flow with Validation

```
Historical Data (forex_candles)
        ↓
   [Loaded to chart]
        ↓
Current Candle (realtime_prices aggregation OR background aggregator)
        ↓
   [VALIDATION CHECK]
        ↓
   ┌─────────────┬─────────────┐
   ↓ VALID       ↓ INVALID     ↓
[Add to chart] [Reject + Log + Warning]
   ↓
[Combine with historical for indicators]
   ↓
[Calculate VWAP, EMA, RSI, etc.]
```

### Validation Logic

1. **Price Range Check**: New candle must be within ±10% of recent average price
2. **Time Check**: New candle timestamp must be >= last historical timestamp
3. **Data Quality Check**: Candle must have valid OHLC values

## Expected Behavior

### Normal Operation
- Indicators (VWAP/EMA) align perfectly with candlestick price range
- No visual separation between candlesticks and indicators
- Console shows validation passes: `✓ Candle validated`

### When Bad Data Detected
- Invalid candles are rejected and logged: `❌ Price anomaly detected!`
- Chart displays warning banner explaining the issue
- Indicators continue calculating from last valid data only
- Chart updates resume when valid data arrives

## Testing the Fix

1. **Monitor Console Logs**: Look for validation messages
   - `✓ Candle validated` = Good data
   - `❌ Price anomaly detected!` = Bad data rejected

2. **Check Chart Display**:
   - All indicators should align with candlestick price range
   - No gaps between candlesticks and indicator lines

3. **Warning Banner**:
   - If you see a yellow warning, validation is working
   - Message explains what data issue was detected

## Configuration

### Adjusting Validation Sensitivity

In `src/services/candle-data-service.ts`, line 37:

```typescript
const MAX_PRICE_DEVIATION_PERCENT = 10; // Adjust if needed
```

- **Increase** (e.g., 15): More lenient, allows bigger price moves
- **Decrease** (e.g., 5): Stricter validation, rejects more outliers

## Files Modified

1. `/src/services/candle-data-service.ts`
   - Added `CandleValidationResult` interface
   - Added `validateCandleAgainstHistorical()` function
   - Updated `aggregatePricesToCurrentCandle()` with validation
   - Added comprehensive logging

2. `/src/components/MarketChart.tsx`
   - Imported validation function
   - Added validation to `updateCurrentCandleFromAggregator()`
   - Added validation to initial chart load
   - Added validation to indicator recalculation
   - Enhanced logging for debugging

## Benefits

1. **Prevents Chart Corruption**: Invalid price data never reaches the chart
2. **Self-Healing**: Chart continues working with last valid data
3. **Transparent**: Console logs show exactly what's happening
4. **User Feedback**: Warning banners explain issues in plain language
5. **Maintainable**: Centralized validation logic, easy to adjust thresholds

## Next Steps

If you continue to see overlapping data:

1. Check console for validation messages
2. Verify which candles are being rejected
3. Investigate source of bad data (realtime_prices table)
4. May need to adjust `MAX_PRICE_DEVIATION_PERCENT` threshold
5. Consider adding data source health monitoring

## Deployment

The fix is ready for deployment. Build completed successfully with no errors.
