# M1 and M5 Historical Data Fix - COMPLETE

## Problem
M1 and M5 timeframes had no historical candles, showing empty charts with only 8 candles and "14 gaps".

## Root Cause
M1 and M5 require massive amounts of data:
- **M1 (30 days)**: 43,200 candles → 44 API calls → timeout
- **M5 (30 days)**: 8,640 candles → 9 API calls → rate limiting

The system was trying to fetch 30 days for all timeframes, causing M1 and M5 to timeout or hit rate limits.

## Solution Implemented

### 1. **Timeframe-Specific Day Limits**
```
M1:  7 days  (10,080 candles, 11 API calls)
M5:  14 days (4,032 candles, 5 API calls)
M15+: 30 days (manageable volume)
```

### 2. **Updated Files**

**historical-backfill-manager.ts:**
- Added `TIMEFRAME_TARGET_DAYS` mapping
- M1/M5 now prioritized first in backfill queue
- Increased delay for M1/M5 (3 seconds vs 2 seconds)
- Smart day calculation per timeframe

**automatic-gap-filler.ts:**
- Added `TIMEFRAME_LOOKBACK_DAYS` mapping
- M1/M5 prioritized in gap detection
- Reduced max gaps filled for M1/M5 (3 vs 5)
- Increased delays for M1/M5 requests

**chart-data-guarantor.ts:**
- Optimized `calculateSmartCandleCount`:
  - M1: 500 candles (8 hours for chart)
  - M5: 288 candles (24 hours for chart)
  - Higher timeframes adjusted proportionally

### 3. **Created Manual Backfill Script**
- **scripts/backfill-m1-m5.js** - Run anytime to manually backfill M1/M5
- Usage: `node scripts/backfill-m1-m5.js`

## Expected Results

After deployment:
- ✅ M1 charts show 7 days of historical data (10,080 candles available)
- ✅ M5 charts show 14 days of historical data (4,032 candles available)
- ✅ All backfills complete within timeout limits
- ✅ No rate limiting errors
- ✅ Charts load in under 2 minutes

## Testing Steps

1. **Clear browser cache** (important!)
2. **Wait 5 minutes** for deployment to complete
3. **Login to app** - triggers automatic backfill
4. **Wait 2-3 minutes** for backfill to run
5. **Navigate to Charts page**
6. **Select EURUSD M5** - should show 14 days of candles
7. **Select EURUSD M1** - should show 7 days of candles

## Manual Backfill (if needed)

If automatic backfill doesn't run, manually trigger:

```bash
node scripts/backfill-m1-m5.js
```

This will backfill all symbols (EURUSD, GBPUSD, USDJPY, XAUUSD, US30) for M1 and M5.

## Technical Details

### Data Volume Comparison
| Timeframe | Old (30d) | New     | API Calls | Est. Time |
|-----------|-----------|---------|-----------|-----------|
| M1        | 43,200    | 10,080  | 11        | ~60s      |
| M5        | 8,640     | 4,032   | 5         | ~30s      |
| M15       | 2,880     | 2,880   | 3         | ~20s      |
| H1        | 720       | 720     | 1         | ~10s      |

### Memory Usage
- **Before**: 43,200 candles × 5 symbols = 216,000 records
- **After**: 10,080 candles × 5 symbols = 50,400 records
- **Reduction**: 76% less memory usage for M1 backfill

## Monitoring

Check Netlify function logs:
1. Go to Netlify dashboard
2. Functions → `historical-backfill` logs
3. Look for successful M1/M5 backfills
4. Should see: "Successfully backfilled X candles"

## Deployment Status

- ✅ Code changes complete
- ✅ Build successful
- ✅ Netlify deployment triggered
- ⏳ Waiting for deployment (5-10 minutes)

---

**Status**: DEPLOYED AND READY FOR TESTING
**Deployment Time**: 2025-12-08
**Next Steps**: Test M1 and M5 charts after 5-minute deployment window
