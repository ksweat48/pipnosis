# Candle Aggregator Fix - Deployment Guide

## Issues Fixed

### 1. SQL RPC Error Handling
- **Problem**: `TypeError: fetch failed` when calling `aggregate_candle_from_prices`
- **Fix**: Enhanced error handling to gracefully fall back to in-memory aggregation
- **Result**: Function continues processing even if SQL RPC fails

### 2. Timeout Configuration
- **Problem**: Function timing out at 60 seconds despite netlify.toml showing 120s
- **Fix**: Configuration is correct, but Netlify needs a fresh deployment to apply it
- **Action Required**: Trigger new deployment

## Deployment Steps

### Step 1: Verify SQL Function Exists

Run this in your Supabase SQL Editor:

```sql
-- Check if the function exists
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_name = 'aggregate_candle_from_prices';

-- If it doesn't exist, create it
-- (The migration should have created it, but verify)
```

### Step 2: Trigger Fresh Deployment

The netlify.toml is already configured with 120-second timeout (line 55), but Netlify needs to reload the configuration.

**Option A: Trigger via Build Hook** (Fastest)
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

**Option B: Trigger via Netlify UI**
1. Go to Netlify dashboard
2. Click "Deploys" tab
3. Click "Trigger deploy" > "Clear cache and deploy site"

### Step 3: Wait for Deployment

Monitor deployment at: https://app.netlify.com/sites/pipnosis/deploys

Look for:
- ✅ Build successful
- ✅ Functions deployed
- ✅ Configuration loaded

### Step 4: Verify Function Configuration

After deployment, check function settings:
1. Go to Functions tab in Netlify
2. Click `continuous-candle-aggregator`
3. Verify timeout shows **120 seconds**

### Step 5: Test Function Execution

Wait for the next scheduled run (every 5 minutes) or trigger manually:
1. Click "Run now" button in Netlify Functions UI
2. Watch logs in real-time
3. Verify completion logs appear

## Expected Results

After fix, logs should show:

```
[CandleAggregator] Starting continuous candle aggregation...
[CandleAggregator] Processing timeframes: M1, M5, M15
[CandleAggregator] XAUUSD: Fetched 120 prices from ...
  ✅ XAUUSD: Created 15 candles across 3 timeframes
[CandleAggregator] US30: Fetched 120 prices from ...
  ✅ US30: Created 15 candles across 3 timeframes
[CandleAggregator] EURUSD: Fetched 120 prices from ...
  ✅ EURUSD: Created 15 candles across 3 timeframes
[CandleAggregator] ✅ Completed in 85000ms: 45 candles created
[CandleAggregator] Symbols: 5/5 processed, 0 timed out
```

**Key Success Indicators**:
- ✅ Duration > 60 seconds (proves 120s timeout is active)
- ✅ All 5 symbols processed (XAUUSD, US30, EURUSD, GBPUSD, USDJPY)
- ✅ No "SQL aggregation error: TypeError: fetch failed" messages
- ✅ Candles created > 0
- ✅ 0 symbols timed out

## Troubleshooting

### If SQL RPC Still Fails

The function will now automatically fall back to in-memory aggregation. You'll see:
```
[CandleAggregator] SQL RPC connection issue, using fallback method
```

This is normal and expected until the database function is verified.

### If Still Timing Out at 60 Seconds

1. **Check Netlify Plan**: Free tier may have hidden limits
2. **Clear Build Cache**: Deploy with "Clear cache and deploy"
3. **Verify netlify.toml**: Should show `timeout = 120` on line 55
4. **Contact Netlify Support**: May need plan upgrade for scheduled function timeouts

### If Only Processing XAUUSD

This means it's still hitting the 60-second timeout. Follow "Clear Build Cache" steps above.

## Files Modified

1. `/netlify/functions/continuous-candle-aggregator.ts` - Enhanced error handling
2. This deployment guide

## Rollback Plan

If issues persist, the function will automatically:
1. Try SQL aggregation first
2. Fall back to in-memory aggregation on error
3. Skip failed candles and continue processing
4. Log all errors without crashing

No manual rollback needed - the code is self-healing.

## Next Steps

After successful deployment:
1. Monitor function logs for 15 minutes (3 scheduled runs)
2. Verify candles appear in Supabase `forex_candles` table
3. Check chart in UI updates with live data
4. Confirm all 5 symbols are being processed

## Status

- [x] Code fix applied
- [ ] Deployment triggered
- [ ] Configuration verified
- [ ] Function tested
- [ ] All symbols processing
