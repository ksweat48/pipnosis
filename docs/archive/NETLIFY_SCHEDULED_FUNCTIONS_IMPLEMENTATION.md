# Netlify Scheduled Functions - 24/7 Candle Creation

## Problem Solved

Previously, candle creation stopped when the browser was closed, creating gaps in chart data. This implementation uses Netlify scheduled functions to maintain continuous candle creation 24/7 without browser dependency or database overload.

## Implementation Overview

### 1. Continuous Price Collection (`continuous-price-collector.ts`)

**Schedule:** Every 2 minutes
**Timeout:** 26 seconds

**What it does:**
- Fetches current prices for all active symbols (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD) from MetaAPI
- Stores bid/ask/spread in the `realtime_prices` table
- Runs continuously regardless of browser state

**Key features:**
- Parallel price fetching for all symbols
- Error handling per symbol (one failure doesn't stop others)
- Detailed logging of prices and spreads
- Automatic cleanup of old prices (handled by database)

### 2. Continuous Candle Aggregation (`continuous-candle-aggregator.ts`)

**Schedule:** Every 5 minutes
**Timeout:** 26 seconds

**What it does:**
- Reads recent prices from `realtime_prices` table (last 30 minutes)
- Aggregates prices into completed candles for all timeframes (M1, M5, M15, M30, H1, H4, D1, W1)
- Only creates candles that are fully complete (not the current in-progress candle)
- Stores completed candles in `forex_candles` table

**Key features:**
- Intelligent candle completion detection
- Only processes completed candles (no partial data)
- Checks last candle time to avoid duplicates
- Upsert logic handles any overlaps gracefully
- Minimal database impact (only writes completed candles)

### 3. Enhanced Gap Detection & Filling (`fill-candle-gaps.ts`)

**Schedule:** Every 5 minutes (unchanged)
**Timeout:** 300 seconds

**Enhanced functionality:**
1. **Gap Detection** - Scans last 24 hours for missing candles
2. **MetaAPI Backfill** - Fetches missing candles directly from MetaAPI (up to 20 gaps)
3. **Database Gap Fill** - Runs existing database gap-fill function as backup

**Key features:**
- Three-step process ensures no gaps are missed
- MetaAPI integration for real data (not interpolated)
- Limits MetaAPI calls to prevent rate limiting (max 20 gaps per run)
- Falls back to database function for any remaining gaps

### 4. Daily Historical Refresh (`scheduled-refresh.ts`)

**Schedule:** Daily at 2 AM (unchanged)
**Timeout:** 600 seconds

**What it does:**
- Fetches the last 200 candles from MetaAPI for all symbols
- Acts as a daily "reset" to catch any long-term gaps
- Ensures database stays synchronized with broker data

## How The System Works Together

```
Every 2 minutes:
  Netlify → Fetch Prices → Store in realtime_prices

Every 5 minutes:
  Netlify → Read recent prices → Aggregate to candles → Store in forex_candles
  Netlify → Detect gaps (last 24h) → Fill with MetaAPI → Run DB gap fill

Daily at 2 AM:
  Netlify → Fetch 200 candles from MetaAPI → Refresh database

When User Opens Page:
  Browser → Load 500 candles from database (already complete!)
  Browser → Start light polling for new candles
  Browser → Subscribe to live tick updates

When User Closes Page:
  Netlify functions continue running
  Database stays updated
  No gaps created
```

## Database Impact

**Minimal and Optimized:**
- Price collection: ~5 symbols × 30 times/hour = 150 inserts/hour
- Candle aggregation: ~5 symbols × 8 timeframes × 12 times/hour = 480 inserts/hour
- Total: ~630 database writes/hour
- No constant polling - just scheduled writes
- Old prices automatically cleaned up

## Configuration (netlify.toml)

```toml
[functions."continuous-price-collector"]
  timeout = 26
  schedule = "*/2 * * * *"  # Every 2 minutes

[functions."continuous-candle-aggregator"]
  timeout = 26
  schedule = "*/5 * * * *"  # Every 5 minutes

[functions."fill-candle-gaps"]
  timeout = 300
  schedule = "*/5 * * * *"  # Every 5 minutes

[functions."scheduled-refresh"]
  timeout = 600
  schedule = "0 2 * * *"    # Daily at 2 AM
```

## Benefits

1. **No Browser Required** - Candles created 24/7 via Netlify
2. **No Database Hammering** - Only write operations, no constant polling
3. **Lightweight** - Functions run for seconds, not constantly
4. **Scalable** - Netlify manages execution
5. **Reliable** - Multiple safety nets (real-time + gap fill + daily refresh)
6. **Cost Effective** - Netlify free tier includes 125k invocations/month
7. **Multiple Timeframes** - All 8 timeframes updated automatically
8. **Gap Protection** - Three-layer approach ensures complete data

## Monitoring

All functions log detailed information:
- Number of prices collected
- Number of candles created
- Gaps detected and filled
- Execution duration
- Any errors encountered

Check Netlify function logs to monitor the system's health.

## Cost Analysis

**Netlify Free Tier:**
- 125,000 function invocations/month
- Our usage: ~21,600 invocations/month (720 per day × 30 days)
- Well within free tier limits

**MetaAPI:**
- Price requests: 720/day (every 2 minutes)
- Historical candle requests: Minimal (only for gaps + daily refresh)
- Should remain within reasonable API limits

## Deployment

The system is configured and ready. To deploy:

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Or push to your git repository if auto-deploy is enabled.

## Next Steps

After deployment:
1. Monitor Netlify function logs for the first hour
2. Check that prices are being collected every 2 minutes
3. Verify candles are being created every 5 minutes
4. Confirm gap detection is working
5. Watch for any MetaAPI rate limiting issues

## Troubleshooting

**If prices aren't being collected:**
- Check MetaAPI credentials in environment variables
- Verify `METAAPI_TOKEN`, `METAAPI_ACCOUNT_ID`, and `METAAPI_REGION`

**If candles aren't being created:**
- Check that prices are in `realtime_prices` table
- Verify `forex_candles` table has proper RLS policies for service role
- Check function logs for errors

**If gaps persist:**
- Increase gap fill frequency (lower schedule interval)
- Check MetaAPI rate limits
- Verify symbols are available for historical data

## Summary

This implementation provides a robust, scalable, and cost-effective solution for continuous candle creation. The system operates independently of browser state, uses minimal database resources, and includes multiple layers of protection against gaps in data.
