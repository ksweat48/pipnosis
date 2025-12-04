# Scheduled Functions Diagnostic Guide

## Current State

Your scheduled functions are **CONFIGURED** but may not be **RUNNING**:

### Configured Functions:
1. **continuous-price-collector** - Runs every 1 minute
   - Collects live prices from MetaAPI
   - Saves to `realtime_prices` table

2. **continuous-candle-aggregator** - Runs every 5 minutes
   - Aggregates prices into candles
   - Saves to `forex_candles` table
   - Backfills missing candles from last 24 hours

## Why You See Gaps

**Browser-based polling only works when page is open:**
- When you close the tab, JavaScript stops
- No new prices collected
- No new candles formed
- Result: GAPS in the chart

**Server-based polling should work 24/7:**
- BUT it requires Netlify scheduled functions to be active
- These may not be running on your account

## How to Verify Functions Are Running

### Option 1: Check Netlify Dashboard

1. Go to https://app.netlify.com
2. Select your Pipnosis project
3. Click "Functions" in the left menu
4. Look for:
   - `continuous-price-collector`
   - `continuous-candle-aggregator`
5. Check "Invocations" count - should be increasing

### Option 2: Check Function Logs

1. In Netlify Dashboard → Functions
2. Click on each function
3. View logs - should show executions every 1-5 minutes
4. Look for: `[PriceCollector] ✅ Completed` messages

### Option 3: Check Database Records

Run this query in Supabase SQL Editor:

```sql
-- Check if prices are being collected when you're NOT on the page
SELECT
  symbol,
  COUNT(*) as price_count,
  MAX(created_at) as last_price,
  MIN(created_at) as first_price
FROM realtime_prices
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY symbol
ORDER BY symbol;

-- Check if candles are being created continuously
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MAX(open_time) as latest_candle,
  MIN(open_time) as earliest_candle
FROM forex_candles
WHERE open_time > NOW() - INTERVAL '24 hours'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

## Solutions

### Solution 1: Enable Scheduled Functions (If Available)

**Netlify Requirements:**
- Scheduled functions require a **Pro plan** or higher ($19/month)
- They are NOT available on free tier

**To Enable:**
1. Upgrade to Netlify Pro: https://app.netlify.com/account/billing
2. Redeploy your site
3. Scheduled functions will automatically start running

### Solution 2: Alternative - External Cron Service (FREE)

Use a free external service to trigger functions every minute:

**Option A: Cron-job.org (Free)**
1. Go to https://cron-job.org/en/
2. Create account
3. Create two jobs:
   - URL: `https://pipnosis.com/.netlify/functions/continuous-price-collector`
   - Schedule: Every 1 minute
   - URL: `https://pipnosis.com/.netlify/functions/continuous-candle-aggregator`
   - Schedule: Every 5 minutes

**Option B: EasyCron (Free)**
1. Go to https://www.easycron.com
2. Create account (100 tasks free)
3. Same setup as above

**Option C: UptimeRobot (Free)**
1. Go to https://uptimerobot.com
2. Create "monitors" for each function URL
3. Set to check every 5 minutes (free tier limit)

### Solution 3: Deploy to Different Platform

**Consider moving scheduled functions to:**
1. **Supabase Edge Functions** - Free scheduled functions via pg_cron
2. **Vercel Cron Jobs** - Free on Hobby plan
3. **Railway.app** - Free cron scheduling
4. **Render.com** - Free cron jobs

## Current Architecture Issue

```
USER CLOSES BROWSER
        ↓
Browser polling STOPS
        ↓
No prices collected
        ↓
No candles formed
        ↓
GAPS appear in chart
```

**Should be:**

```
USER CLOSES BROWSER
        ↓
Server continues collecting
        ↓
Scheduled functions run every minute
        ↓
Candles continue forming
        ↓
NO GAPS - continuous data
```

## Immediate Action Required

1. **Check if functions are actually running** using Option 2 above
2. **If NOT running**: Use Solution 2 (external cron) as FREE temporary fix
3. **Long-term**: Either upgrade Netlify or migrate to platform with free cron

## Test Right Now

Close this browser tab completely for 10 minutes, then come back and check:
- Are there new candles in the chart from while you were gone?
- Check the database with the SQL query above
- If NO new data → Functions are NOT running
