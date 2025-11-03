# Complete Candle Persistence Setup Guide

## Overview

This guide will help you set up the automated candle aggregation system that ensures **ALL forex pairs** and **ALL timeframes** maintain continuous data, regardless of whether anyone is viewing the charts.

---

## What Was Updated

### ✅ Edge Function Enhanced
- **Function**: `aggregate-candles` (now deployed with updates)
- **Added Timeframes**: H4, D1, W1 (in addition to existing M1, M5, M15, M30, H1)
- **Total Timeframes**: 8 (M1, M5, M15, M30, H1, H4, D1, W1)
- **Lookback Period**: Increased from 15 minutes to 24 hours for better coverage
- **Symbols**: All 12 pairs (XAUUSD, US30, EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, EURGBP, EURJPY, GBPJPY)

---

## Setup Instructions

### Step 1: Get Your Credentials

You'll need two pieces of information from your Supabase Dashboard:

1. **Go to Settings → General**
   - Copy your **Project Reference ID**
   - Example: `abcdefghijklmnop`

2. **Go to Settings → API**
   - Scroll down and copy your **service_role key** (the secret one)
   - ⚠️ Keep this secure - don't share it publicly!

---

### Step 2: Enable Required Extensions

1. Go to **Database → Extensions** in Supabase Dashboard
2. Search for and enable these extensions:
   - `pg_cron` (for scheduling)
   - `http` (for making HTTP requests)

If they're already enabled, skip this step.

---

### Step 3: Create the Cron Job

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **New Query**
3. Copy and paste this SQL code:

```sql
-- =====================================================
-- CANDLE AGGREGATION CRON JOB
-- Runs every 5 minutes to convert ticks into candles
-- for ALL symbols and ALL timeframes
-- =====================================================

SELECT cron.schedule(
  'aggregate-candles-every-5-minutes',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/aggregate-candles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) AS request_id;
  $$
);
```

4. **IMPORTANT**: Replace these placeholders:
   - `YOUR_PROJECT_REF` → Your project reference from Step 1
   - `YOUR_SERVICE_ROLE_KEY` → Your service role key from Step 1

5. Click **Run** (or press Ctrl+Enter)

6. You should see: `SELECT 1` (success message)

---

### Step 4: Verify the Cron Job

Run this query to confirm it was created:

```sql
SELECT
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname = 'aggregate-candles-every-5-minutes';
```

You should see one row with:
- `active = true`
- `schedule = */5 * * * *`

---

### Step 5: Wait and Verify It's Working

**Wait 5-10 minutes** for the first run to execute.

Then check the logs:

```sql
-- View recent aggregation runs
SELECT
  executed_at,
  status,
  ticks_processed,
  candles_created,
  symbols_processed,
  duration_ms,
  message
FROM candle_aggregation_log
ORDER BY executed_at DESC
LIMIT 10;
```

**What to expect:**
- New entries every 5 minutes
- `status = 'success'`
- `symbols_processed = 12` (all pairs)
- `candles_created` > 0 (varies based on tick activity)

---

### Step 6: Verify Candles for All Timeframes

Check that candles are being created across all symbols and timeframes:

```sql
-- Check candle coverage
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MAX(open_time) as latest_candle,
  MIN(open_time) as oldest_candle
FROM forex_candles
WHERE open_time >= NOW() - INTERVAL '2 hours'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

**What to expect:**
- Data for all 12 symbols
- Data for all 8 timeframes (M1, M5, M15, M30, H1, H4, D1, W1)
- `latest_candle` should be recent (within last few minutes for short timeframes)

---

## Optional: Daily Cleanup Job

To automatically remove old tick data and save storage:

```sql
-- =====================================================
-- TICK DATA CLEANUP CRON JOB
-- Runs daily at 2 AM UTC to remove ticks older than 24h
-- =====================================================

SELECT cron.schedule(
  'cleanup-old-ticks-daily',
  '0 2 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-old-ticks',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) AS request_id;
  $$
);
```

Same replacements as before, then run it.

---

## Testing the Complete System

### Test 1: Chart Persistence Across Symbols

1. Open your app
2. View EUR/USD on M5
3. Switch to GBP/JPY on H4
4. Switch to XAU/USD on M15
5. Wait 10 minutes
6. Return to EUR/USD on M5
7. **Expected**: Continuous candles with no gaps

### Test 2: Background Persistence

1. Close your app completely
2. Wait 30+ minutes
3. Reopen the app
4. Load any symbol/timeframe
5. **Expected**: Continuous data covering the entire time you were away

### Test 3: All Timeframes Work

Test each timeframe on any symbol:
- M1 (1 minute)
- M5 (5 minutes)
- M15 (15 minutes)
- M30 (30 minutes)
- H1 (1 hour)
- H4 (4 hours)
- D1 (1 day)
- W1 (1 week)

All should load and update properly.

---

## Monitoring and Health Checks

### Quick Health Check

Run this daily to ensure everything is working:

```sql
-- Aggregation health summary
SELECT
  status,
  COUNT(*) as run_count,
  MAX(executed_at) as last_run,
  AVG(duration_ms) as avg_duration,
  SUM(candles_created) as total_candles
FROM candle_aggregation_log
WHERE executed_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;
```

**Good indicators:**
- `success` count ≈ 288 per day (every 5 min = 288 runs/day)
- `avg_duration` < 10000ms (under 10 seconds)
- `total_candles` > 1000 (depends on market activity)

### Check Polling System

Verify ticks are being collected:

```sql
-- Recent tick data
SELECT
  symbol,
  COUNT(*) as tick_count,
  MAX(created_at) as latest_tick
FROM realtime_prices
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY symbol
ORDER BY symbol;
```

**What to expect:**
- All 12 symbols present
- `tick_count` > 100 for each (varies by market activity)
- `latest_tick` within last few minutes

### View Job Execution Details

```sql
-- Detailed execution log with errors
SELECT
  start_time,
  end_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid = (
  SELECT jobid
  FROM cron.job
  WHERE jobname = 'aggregate-candles-every-5-minutes'
)
ORDER BY start_time DESC
LIMIT 10;
```

---

## Troubleshooting

### Issue: Cron job not running

**Check if job is active:**
```sql
SELECT * FROM cron.job WHERE jobname = 'aggregate-candles-every-5-minutes';
```

**Reactivate if needed:**
```sql
UPDATE cron.job
SET active = true
WHERE jobname = 'aggregate-candles-every-5-minutes';
```

### Issue: No candles being created

**1. Check if ticks exist:**
```sql
SELECT COUNT(*) FROM realtime_prices
WHERE created_at >= NOW() - INTERVAL '15 minutes';
```

If 0, the polling system isn't running. Check browser console for errors.

**2. Check aggregation log for errors:**
```sql
SELECT * FROM candle_aggregation_log
WHERE status = 'error'
ORDER BY executed_at DESC
LIMIT 5;
```

**3. Test function manually:**

In your app's browser console:
```javascript
const url = 'YOUR_SUPABASE_URL/functions/v1/aggregate-candles';
const key = 'YOUR_ANON_KEY';

fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

### Issue: Some timeframes missing data

**Check specific timeframe:**
```sql
SELECT symbol, COUNT(*) as candle_count
FROM forex_candles
WHERE timeframe = 'H4'
  AND open_time >= NOW() - INTERVAL '7 days'
GROUP BY symbol;
```

If missing, wait for next cron run (max 5 minutes).

### Issue: Want to delete and recreate cron job

```sql
-- Delete the job
SELECT cron.unschedule('aggregate-candles-every-5-minutes');

-- Then run the CREATE query from Step 3 again
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│          Automated Candle Persistence System        │
└─────────────────────────────────────────────────────┘

1. Tick Collection (Continuous)
   ┌──────────────────┐
   │ Global Polling   │──► Fetches live prices every 1-5s
   │ Coordinator      │──► Inserts into realtime_prices
   └──────────────────┘    (All 12 symbols)

2. Candle Aggregation (Every 5 Minutes)
   ┌──────────────────┐
   │ Supabase Cron    │──► Triggers aggregate-candles function
   │ Job (pg_cron)    │──► Processes last 24h of ticks
   └──────────────────┘──► Creates candles for all timeframes
                       └──► Saves to forex_candles + market_data

3. Chart Display (On-Demand)
   ┌──────────────────┐
   │ MarketChart      │──► Loads pre-aggregated candles
   │ Component        │──► Updates current incomplete candle
   └──────────────────┘──► Subscribes to new completed candles

4. Data Cleanup (Daily at 2 AM)
   ┌──────────────────┐
   │ Cleanup Cron     │──► Removes ticks older than 24h
   │ Job              │    (After verifying candles exist)
   └──────────────────┘
```

---

## Key Benefits

✅ **24/7 Data Continuity** - Candles created even when no users are online
✅ **All Pairs, All Timeframes** - Complete coverage across 12 symbols × 8 timeframes
✅ **No Browser Dependency** - Backend handles aggregation automatically
✅ **Instant Chart Loading** - Pre-aggregated data ready to display
✅ **Storage Efficient** - Only 24h of tick data, unlimited candle history
✅ **Easy Monitoring** - Built-in health checks and logs
✅ **Gap Prevention** - Continuous processing prevents missing candles

---

## Support Queries

### Check overall system status
```sql
SELECT
  'Cron Job' as component,
  CASE WHEN active THEN '✅ Active' ELSE '❌ Inactive' END as status
FROM cron.job
WHERE jobname = 'aggregate-candles-every-5-minutes'
UNION ALL
SELECT
  'Recent Runs' as component,
  COUNT(*)::text || ' runs in last hour' as status
FROM candle_aggregation_log
WHERE executed_at >= NOW() - INTERVAL '1 hour'
UNION ALL
SELECT
  'Tick Collection' as component,
  COUNT(*)::text || ' ticks in last 15 min' as status
FROM realtime_prices
WHERE created_at >= NOW() - INTERVAL '15 minutes'
UNION ALL
SELECT
  'Candle Coverage' as component,
  COUNT(DISTINCT symbol)::text || ' symbols with data' as status
FROM forex_candles
WHERE open_time >= NOW() - INTERVAL '1 hour';
```

---

## Next Steps After Setup

1. ✅ Verify cron job is running (Step 4)
2. ✅ Wait 1 hour for data to accumulate
3. ✅ Test all symbol/timeframe combinations
4. ✅ Verify persistence across sessions
5. ✅ Set up daily health monitoring
6. ✅ Configure cleanup job (optional but recommended)

---

**System Status**: ✅ Deployed and Ready
**Last Updated**: 2025-11-03
**Edge Function Version**: v2.0 (with H4, D1, W1 support)
