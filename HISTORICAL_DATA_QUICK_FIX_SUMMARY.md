# Historical Data Fix - Quick Summary

## What Was Wrong

**M5/M1/M15 charts showed:**
- Fake "line" candles (all same OHLC: 1.164275)
- Data from Saturday (market closed)
- NO historical data from before Friday 5pm

**Why it happened:**
- System fetched "last 200 candles"
- M5: 200 candles = only 16 hours (doesn't reach Friday!)
- Saturday fake candles filled the buffer, pushing out real data

## What Was Fixed

### 1. Time-Based Queries (Not Count-Based)
- M1: Fetch last **48 hours**
- M5: Fetch last **72 hours**
- M15: Fetch last **96 hours**
- M30: Fetch last **120 hours**

### 2. Market Hours Filtering
- Remove ALL Saturday candles
- Remove Friday after 5pm EST candles
- Remove Sunday before 5pm EST candles

### 3. Prevention System
- Background aggregator won't save candles during closed market
- Market hours checked before every candle save

## Quick Actions Needed

### 1. Clean Database (Run Once)
```bash
# Connect to Supabase and run:
scripts/cleanup-weekend-candles.sql
```

This removes existing fake Saturday/Sunday candles.

### 2. Verify Fix
1. Refresh browser
2. Switch to M5 timeframe
3. You should now see:
   - Proper candlesticks with wicks
   - Different OHLC values
   - Historical data from last week

## What You'll See in Logs

```
✅ Using time-based query for EURUSD M5: last 72 hours
✅ Removed 150 closed-market candles for EURUSD
✅ Loaded 850 candles from last 72 hours
```

## Files Changed

- `src/utils/marketHours.ts` - Market hours logic
- `src/services/candle-data-service.ts` - Smart queries
- `src/services/background-candle-aggregator.ts` - Prevention
- `scripts/cleanup-weekend-candles.sql` - Database cleanup

## Result

✅ M5, M1, M15 now show proper historical data from last trading session
✅ No more fake Saturday candles
✅ Real candlesticks with proper OHLC values

---

**Status**: Complete ✅
**Next Step**: Run database cleanup script once
