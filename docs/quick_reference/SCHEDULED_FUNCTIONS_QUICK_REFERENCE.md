# Netlify Scheduled Functions - Quick Reference

## What Was Implemented

Three new Netlify scheduled functions that run 24/7 to maintain continuous candle data without requiring your browser to be open.

## The Functions

### 1. continuous-price-collector
- **Runs:** Every 2 minutes
- **Does:** Fetches current prices from MetaAPI → Stores in `realtime_prices` table
- **Symbols:** EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD

### 2. continuous-candle-aggregator
- **Runs:** Every 5 minutes
- **Does:** Reads prices from database → Aggregates into candles → Stores in `forex_candles`
- **Timeframes:** M1, M5, M15, M30, H1, H4, D1, W1

### 3. fill-candle-gaps (Enhanced)
- **Runs:** Every 5 minutes
- **Does:** Detects gaps in last 24 hours → Fills with MetaAPI → Runs DB gap fill

### 4. scheduled-refresh (Existing)
- **Runs:** Daily at 2 AM
- **Does:** Fetches 200 candles from MetaAPI for all symbols

## How to Monitor

**Check Netlify Function Logs:**
1. Go to Netlify Dashboard
2. Click on your site
3. Go to "Functions" tab
4. Click on a function to see its logs
5. Look for execution results every 2-5 minutes

**What to Look For:**
- `[PriceCollector] ✅ Completed` - Price collection successful
- `[CandleAggregator] ✅ Completed: X candles created` - Candles being created
- `[FillCandleGaps] ✅ Completed` - Gaps being filled

## Expected Behavior

**Every 2 minutes:**
- Should see 5 prices collected (one for each symbol)
- Each price should show bid/ask/spread

**Every 5 minutes:**
- Should see candles being created across multiple timeframes
- Number varies based on completed candles since last run

**Every 5 minutes:**
- Gap detection should report any missing candles
- MetaAPI should fill detected gaps

## Database Impact

- ~150 price records per hour
- ~480 candle records per hour
- Total: ~630 writes per hour (very light)
- Old prices auto-cleaned after 24 hours

## Cost

- Netlify: FREE (well within 125k invocations/month)
- MetaAPI: Normal usage (within limits)

## Troubleshooting

### No Prices Being Collected
**Check:** Environment variables in Netlify
- `METAAPI_TOKEN`
- `METAAPI_ACCOUNT_ID`
- `METAAPI_REGION`
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### No Candles Being Created
**Check:**
1. Are prices in `realtime_prices` table?
2. Function logs for errors
3. Database RLS policies (should allow service role writes)

### Gaps Still Appearing
**Check:**
1. Gap fill function logs
2. MetaAPI rate limits (may need to reduce frequency)
3. Symbol availability for historical data

## Files Changed

1. ✅ `/netlify/functions/continuous-price-collector.ts` - NEW
2. ✅ `/netlify/functions/continuous-candle-aggregator.ts` - NEW
3. ✅ `/netlify/functions/fill-candle-gaps.ts` - ENHANCED
4. ✅ `/netlify.toml` - UPDATED schedules

## Next Steps

1. **Wait 5-10 minutes** after deployment
2. **Check function logs** in Netlify dashboard
3. **Verify prices** appearing in `realtime_prices` table
4. **Verify candles** appearing in `forex_candles` table
5. **Close your browser** and wait 30 minutes
6. **Reopen and check** - you should see continuous candles with no gaps

## Success Indicators

- ✅ Function logs show regular executions every 2-5 minutes
- ✅ `realtime_prices` table has fresh data (last 2 minutes)
- ✅ `forex_candles` table has continuous candles (no gaps)
- ✅ Charts load instantly with 500 candles
- ✅ No gaps appear after closing browser for hours

## If You Need to Stop the Functions

Edit `netlify.toml` and remove the `schedule` lines:

```toml
# Comment out or remove these lines:
# [functions."continuous-price-collector"]
#   timeout = 26
#   schedule = "*/2 * * * *"
```

Then redeploy. The functions will remain available for manual calls but won't run automatically.

## Support

If issues persist:
1. Check function logs in Netlify
2. Check Supabase logs for database errors
3. Verify MetaAPI account status
4. Review environment variables are set correctly
