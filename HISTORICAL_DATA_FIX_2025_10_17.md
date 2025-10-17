# Historical Data Display Fix - October 17, 2025

## Problem Summary

The charts were displaying very sparse data with only a few candles visible, despite the database containing substantial historical data. The EMA and VWAP indicators appeared as mostly flat lines instead of showing proper technical analysis overlays.

## Root Cause Analysis

### 1. Database Investigation
- **market_data table**: Contains 500-10,000+ candles per symbol/timeframe
  - EURUSD M15: 1,673 candles (24 days coverage)
  - GBPUSD M15: 735 candles (21 days coverage)
  - XAUUSD M15: 606 candles (21 days coverage)
  - US30 M15: 501 candles (14 days coverage)

- **historical_candles table**: Empty (no data)

### 2. Cache Freshness Threshold Issue
The cache validation logic had **overly strict freshness thresholds**:

**Old Thresholds:**
- M1: 1 hour
- M5: 4 hours
- M15: **8 hours** ← TOO STRICT
- M30: 12 hours
- H1: 24 hours
- H4: 48 hours

**Actual Data Age:**
- GBPUSD: 30 hours old (STALE)
- US30: 172 hours old (VERY STALE)
- XAUUSD: 16 hours old (STALE)

When data was deemed "stale", the system would:
1. Reject the cached data
2. Attempt to fetch from MetaAPI
3. If MetaAPI failed or was in demo mode → return empty/minimal data
4. Chart would display with very few candles

### 3. Poor Fallback Logic
When cache validation failed and API was unavailable, the code didn't have proper fallback to use the cached data anyway. The logic flow was:

```
if (cache valid) → use cache
else if (API available) → fetch from API
else → FAIL (return no data)
```

It should have been:
```
if (cache valid) → use cache
else if (API available) → fetch from API
else → FALLBACK to cache anyway (better stale data than no data)
```

## Solutions Implemented

### 1. Relaxed Cache Freshness Thresholds
Updated thresholds to be more realistic for trading environments where markets close on weekends:

**New Thresholds:**
- M1: 2 hours
- M5: 12 hours
- M15: **24 hours** (3x increase)
- M30: 48 hours (4x increase)
- H1: 72 hours (3x increase)
- H4: 7 days
- D1: 14 days (2x increase)
- W1: 30 days (2x increase)
- MN1: 60 days (2x increase)

This allows the system to use cached data over weekends and during market closures without constantly trying to fetch fresh data.

### 2. Enhanced Fallback Logic
Added multiple layers of fallback to ensure we ALWAYS return data if it exists:

```typescript
let cachedCandlesBackup: CandleData[] = [];

// Layer 1: Try to use cache if valid
if (cache valid) → use cache

// Layer 2: Store cache as backup before API attempt
cachedCandlesBackup = cachedCandles;

// Layer 3: Try API if needed
if (API fetch fails) {
  // Fallback 3a: Use backup cache
  if (cachedCandlesBackup.length > 0) → use backup
  // Fallback 3b: Query cache again
  else → query cache again
}

// Layer 4: Final safety net after merge
if (mergeResult is empty) {
  // Fallback 4a: Use backup cache
  if (cachedCandlesBackup.length > 0) → use backup
  // Fallback 4b: Last resort cache query
  else → final cache query
}
```

### 3. Improved Demo Mode Handling
When in demo mode (MetaAPI credentials not configured), the system now:
- Immediately uses cached data without validation
- Skips freshness checks entirely
- Never attempts API calls
- Logs clear messages about demo mode operation

## Files Modified

### `/src/services/market-data.ts`
- Updated `getCacheFreshnessThreshold()` with relaxed thresholds
- Modified `getHistoricalData()` to store cache backup
- Enhanced error handling with multiple fallback layers
- Added final safety net before returning empty data
- Improved demo mode logic flow

## Expected Results

After this fix:
1. Charts should display full historical data (500-1000+ candles)
2. EMA lines should show proper curves across the data range
3. VWAP should display as a proper technical indicator line
4. Data should load even when MetaAPI is unavailable
5. Weekends/market closures won't cause data loss
6. Demo mode will work reliably with cached data

## Testing Recommendations

1. **Clear Browser Cache**: Hard refresh (Ctrl+Shift+R) to ensure new code loads
2. **Check Console Logs**: Look for messages like:
   - "✅ Using X cached candles as final fallback"
   - "💾 Demo mode: Using X cached candles"
   - "📊 Cache validation for SYMBOL TIMEFRAME"
3. **Test Each Symbol**: EURUSD, GBPUSD, XAUUSD, US30
4. **Test Each Timeframe**: M1, M5, M15, M30, H1, H4, D1
5. **Verify EMA Display**: All EMA lines should show curves
6. **Verify VWAP Display**: VWAP line should be visible

## Database Status

Current database contains good historical data:
- EURUSD: 10,126 M1 candles, 3,340 M5 candles, 1,673 M15 candles
- GBPUSD: 2,080 M1 candles, 2,070 M5 candles, 735 M15 candles
- XAUUSD: 1,990 M1 candles, 1,963 M5 candles, 606 M15 candles
- US30: 500-788 candles across various timeframes

This data is sufficient for full chart display and technical analysis.

## Next Steps

If charts still show sparse data after this fix:
1. Check browser console for any errors or warnings
2. Verify the build was deployed (check timestamp in Settings)
3. Check database connectivity (Settings → Database Health)
4. Try the "Fix Data" button on the chart if data quality is still low
5. Consider running the historical backfill service for missing date ranges
