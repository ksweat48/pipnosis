# Historical Chart Data Fix - Lower Timeframes Complete

## Problem Summary

The M5, M1, and M15 timeframes were not showing historical data from before Friday 5pm when viewed on Saturday/Sunday. Instead, the charts showed:

1. **Fake "line" candles** with identical OHLC values (all the same price)
2. **Data from Saturday** (market closed) instead of historical data from last trading session
3. **No proper candlesticks** with wicks or body - just vertical lines

### Root Cause

- System was fetching the "last 200 candles" from the database
- For M5: 200 candles = only 16.7 hours (doesn't reach Friday 5pm)
- For M15: 200 candles = only 50 hours (barely reaches Thursday)
- Database contained fake candles created during market closure (Saturday)
- These fake Saturday candles filled up the 200-candle buffer, pushing out real historical data

## Solution Implemented

### 1. Market Hours Helper Functions (`src/utils/marketHours.ts`)

Added three new functions:

- **`isMarketOpenAt(timestamp)`**: Check if a Unix timestamp was during open market hours
  - Returns false for Saturday (all day)
  - Returns false for Friday after 5pm EST
  - Returns false for Sunday before 5pm EST

- **`getLastMarketCloseTime()`**: Get the timestamp of the last market close (Friday 5pm EST)

- **`getTimeframeLookbackHours(timeframe)`**: Calculate appropriate lookback hours for each timeframe
  - M1: 48 hours (2880 candles)
  - M5: 72 hours (864 candles)
  - M15: 96 hours (384 candles)
  - M30: 120 hours (240 candles)
  - H1+: Use existing count-based approach

### 2. Candle Data Service Updates (`src/services/candle-data-service.ts`)

**Time-Based Queries for Lower Timeframes:**
- Changed from count-based (`LIMIT 200`) to time-based queries for M1, M5, M15, M30
- Fetches ALL candles from the lookback period, not just the last 200
- Ensures enough historical data even when market is closed

**Market Hours Filtering:**
- Added `filterCandlesByMarketHours()` function
- Removes ALL candles from closed market periods
- Applied to both `fetchPreAggregatedCandles()` and `fetchCandlesByTimeRange()`

### 3. Background Candle Aggregator Updates (`src/services/background-candle-aggregator.ts`)

**Prevention of Future Fake Candles:**
- Added market hours check in `saveCompletedCandle()`
- Prevents saving candles during closed market periods
- Stops fake candles from being created on Saturday/Sunday

### 4. Database Cleanup Script (`scripts/cleanup-weekend-candles.sql`)

**Removes Existing Fake Candles:**
- Identifies candles with identical OHLC values (fake/reconstructed)
- Deletes candles from Saturday, Friday after 5pm, Sunday before 5pm
- Provides verification queries to confirm cleanup

## How to Use

### 1. Clean Up Existing Fake Candles

Run the cleanup script to remove fake candles from the database:

```sql
-- Connect to your Supabase database and run:
\i scripts/cleanup-weekend-candles.sql
```

Or execute via Supabase dashboard SQL editor.

### 2. Refresh Charts

After cleanup:
1. Refresh your browser
2. Navigate to M5, M1, or M15 timeframes
3. You should now see proper historical candles from the last trading session

## Expected Behavior

### Before Fix:
- M5: Showed 200 fake "line" candles from Saturday (16 hours)
- All candles had identical OHLC (e.g., 1.164275 for all values)
- No historical data from Friday or earlier

### After Fix:
- M5: Shows proper historical candles from last 72 hours of **open market**
- Candles have proper OHLC variation with wicks and bodies
- Historical data from before Friday 5pm is visible
- No Saturday/Sunday candles appear

## Technical Details

### Query Strategy Change

**Before (Count-Based):**
```sql
SELECT * FROM forex_candles
WHERE symbol = 'EURUSD' AND timeframe = 'M5'
ORDER BY open_time DESC
LIMIT 200;  -- Only 16.7 hours for M5
```

**After (Time-Based with Filtering):**
```sql
SELECT * FROM forex_candles
WHERE symbol = 'EURUSD'
  AND timeframe = 'M5'
  AND open_time >= NOW() - INTERVAL '72 hours'  -- Get enough data
ORDER BY open_time ASC;

-- Then filter client-side to remove closed market candles
```

### Market Hours Logic

```typescript
// Saturday check
if (dayOfWeek === 6) return false;

// Friday after 5pm EST
if (dayOfWeek === 5 && totalMinutes >= 1020) return false;

// Sunday before 5pm EST
if (dayOfWeek === 0 && totalMinutes < 1020) return false;

return true;
```

## Files Modified

1. `src/utils/marketHours.ts` - Added 3 helper functions
2. `src/services/candle-data-service.ts` - Time-based queries + market hours filtering
3. `src/services/background-candle-aggregator.ts` - Prevention logic
4. `scripts/cleanup-weekend-candles.sql` - Database cleanup script (new)

## Verification

To verify the fix is working:

1. **Check console logs** - should see:
   - "Using time-based query for EURUSD M5: last 72 hours"
   - "✅ Removed N closed-market candles for EURUSD"
   - "🚫 Filtered out closed-market candle for EURUSD: [Saturday timestamp]"

2. **Check chart display**:
   - Candles should have different OHLC values
   - Candles should have visible wicks
   - Should see historical data from last week

3. **Check database**:
   ```sql
   -- Should return 0 rows:
   SELECT COUNT(*) FROM forex_candles
   WHERE EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 6;
   ```

## Performance Impact

- **Minimal** - Time-based queries with proper indexes are efficient
- Lower timeframes fetch more data but it's filtered quickly
- No impact on higher timeframes (H1, H4, D1, W1)
- Background aggregator now saves slightly fewer candles (good - less fake data)

## Future Improvements

1. Add database constraint to prevent inserting closed-market candles
2. Add index on `open_time` for faster time-range queries
3. Consider caching the "last market close time" to reduce calculations

## Related Issues Fixed

- Charts showing identical OHLC values during weekends
- Missing historical data on lower timeframes
- Fake candles being created during market closure
- Weekend data contaminating chart display

---

**Status**: ✅ Complete and tested
**Build**: ✅ Successful
**Breaking Changes**: None
**Deployment**: Ready
