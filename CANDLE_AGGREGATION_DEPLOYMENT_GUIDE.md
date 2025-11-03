# Candle Aggregation System - Deployment Guide

## Overview

This guide covers the deployment and configuration of the backend candle aggregation system that ensures continuous 5-minute candle creation from realtime tick data, even when users are not actively viewing charts.

## What Was Implemented

### 1. Backend Candle Aggregation (Edge Function)
- **Function**: `aggregate-candles`
- **Purpose**: Runs every 5 minutes to convert realtime_prices (ticks) into completed OHLC candles
- **Storage**: Saves to both `forex_candles` and `market_data` tables
- **Timeframes**: M1, M5, M15, M30, H1
- **Symbols**: All 12 forex pairs (XAUUSD, US30, EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, EURGBP, EURJPY, GBPJPY)

### 2. Tick Data Cleanup (Edge Function)
- **Function**: `cleanup-old-ticks`
- **Purpose**: Removes realtime_prices older than 24 hours to manage storage
- **Retention**: Keeps 24 hours of tick history for backfilling and debugging
- **Safety**: Only deletes after verifying candles were created

### 3. Database Enhancements
- **New Table**: `candle_aggregation_log` - Tracks job execution and health
- **Performance Indexes**: Added indexes on realtime_prices, forex_candles, market_data
- **New Column**: `tick_count` in forex_candles showing data quality
- **Functions**: `cleanup_old_realtime_prices()`, `get_aggregation_stats()`
- **View**: `aggregation_health` for easy monitoring

### 4. Browser-Side Improvements
- **Gap Detection**: Automatically detects missing candles in historical data
- **Backfill Service**: Fills gaps by querying tick data and aggregating on-the-fly
- **Data Quality Warnings**: Displays alerts when gaps are detected and filled
- **Simplified Logic**: Browser now only handles current incomplete candle

## Deployment Status

✅ **Edge Functions Deployed**
- `aggregate-candles` - Active
- `cleanup-old-ticks` - Active

✅ **Database Migration Applied**
- All indexes created
- Monitoring table and functions ready
- RLS policies configured

✅ **Frontend Code Updated**
- Backfill service integrated
- Chart component updated
- Data quality warnings added

## Next Steps: Setting Up Cron Jobs

### IMPORTANT: Manual Configuration Required

The edge functions are deployed, but you need to set up **Supabase Cron Jobs** to run them automatically.

#### 1. Set Up Candle Aggregation (Every 5 Minutes)

1. Go to your Supabase Dashboard
2. Navigate to **Database** → **Cron Jobs** (or use pg_cron extension)
3. Create a new cron job:

```sql
-- Run aggregate-candles every 5 minutes
SELECT cron.schedule(
  'aggregate-candles-job',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT extensions.http_post(
    url := 'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/aggregate-candles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer [YOUR-SERVICE-ROLE-KEY]'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Replace**:
- `[YOUR-PROJECT-REF]` with your Supabase project reference
- `[YOUR-SERVICE-ROLE-KEY]` with your service role key (found in Settings → API)

#### 2. Set Up Tick Cleanup (Daily)

```sql
-- Run cleanup-old-ticks daily at 2 AM UTC
SELECT cron.schedule(
  'cleanup-old-ticks-job',
  '0 2 * * *',  -- Daily at 2 AM UTC
  $$
  SELECT extensions.http_post(
    url := 'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/cleanup-old-ticks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer [YOUR-SERVICE-ROLE-KEY]'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

#### Alternative: Use Supabase Triggers (Recommended)

If your Supabase plan includes native cron triggers:

1. Go to **Edge Functions** in your Supabase Dashboard
2. Click on `aggregate-candles`
3. Add a cron trigger: `*/5 * * * *` (every 5 minutes)
4. Click on `cleanup-old-ticks`
5. Add a cron trigger: `0 2 * * *` (daily at 2 AM)

## Testing the System

### 1. Manual Test - Trigger Aggregation

Test the aggregation function manually:

```bash
curl -X POST \
  'https://[YOUR-PROJECT-REF].supabase.co/functions/v1/aggregate-candles' \
  -H 'Authorization: Bearer [YOUR-ANON-KEY]' \
  -H 'Content-Type: application/json'
```

Expected response:
```json
{
  "message": "Candle aggregation completed",
  "ticksProcessed": 150,
  "candlesCreated": 25,
  "symbolsProcessed": 12,
  "duration": 2500,
  "results": [...]
}
```

### 2. Check Aggregation Logs

Query the logs to verify execution:

```sql
SELECT * FROM candle_aggregation_log
ORDER BY executed_at DESC
LIMIT 10;
```

### 3. Verify Candles Were Created

Check if candles are being saved:

```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MAX(open_time) as latest_candle,
  AVG(tick_count) as avg_ticks_per_candle
FROM forex_candles
WHERE open_time >= now() - interval '1 hour'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

### 4. Monitor Aggregation Health

Use the built-in view:

```sql
SELECT * FROM aggregation_health;
```

Or get detailed stats:

```sql
SELECT * FROM get_aggregation_stats(24);
```

### 5. Test Backfill Logic

1. Leave the application for 30+ minutes
2. Return and open a chart
3. Check browser console for backfill messages:
   ```
   [Backfill] Detected 6 gaps in EURUSD M5 data
   [Backfill] ✓ Backfilled 6 gaps, created 6 candles
   ```

## Monitoring and Maintenance

### Health Checks

Run this query daily to ensure the system is healthy:

```sql
SELECT
  status,
  count,
  last_occurrence,
  avg_duration_ms,
  total_candles
FROM aggregation_health;
```

**Expected Results**:
- `success` count should be ~288 per day (every 5 min = 288 runs/day)
- `avg_duration_ms` should be < 5000ms
- `total_candles` should be increasing steadily

### Troubleshooting

#### No Candles Being Created

1. Check if tick data exists:
   ```sql
   SELECT COUNT(*), MAX(created_at)
   FROM realtime_prices
   WHERE created_at >= now() - interval '15 minutes';
   ```

2. Check aggregation logs for errors:
   ```sql
   SELECT * FROM candle_aggregation_log
   WHERE status = 'error'
   ORDER BY executed_at DESC LIMIT 5;
   ```

3. Verify cron job is running:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'aggregate-candles-job';
   ```

#### Chart Shows Irregular Time Intervals

1. Check for gaps in candle data:
   ```sql
   WITH time_gaps AS (
     SELECT
       symbol,
       open_time,
       LEAD(open_time) OVER (PARTITION BY symbol ORDER BY open_time) as next_time,
       EXTRACT(EPOCH FROM (LEAD(open_time) OVER (PARTITION BY symbol ORDER BY open_time) - open_time)) / 60 as gap_minutes
     FROM forex_candles
     WHERE timeframe = 'M5' AND open_time >= now() - interval '6 hours'
   )
   SELECT * FROM time_gaps
   WHERE gap_minutes > 7  -- More than 5 min + buffer
   ORDER BY gap_minutes DESC;
   ```

2. Backfill will automatically handle gaps when charts load
3. If gaps persist, check if polling is working:
   ```sql
   SELECT COUNT(*), MAX(created_at)
   FROM realtime_prices
   WHERE created_at >= now() - interval '1 hour';
   ```

#### High Storage Usage

Monitor realtime_prices size:

```sql
SELECT
  COUNT(*) as total_ticks,
  MIN(created_at) as oldest,
  MAX(created_at) as newest,
  COUNT(*) * 100 / 1000000.0 as estimated_mb
FROM realtime_prices;
```

If > 24 hours of data exists, manually run cleanup:

```sql
SELECT * FROM cleanup_old_realtime_prices();
```

## Performance Optimization

### Index Health

Verify indexes are being used:

```sql
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename IN ('realtime_prices', 'forex_candles', 'market_data')
ORDER BY idx_scan DESC;
```

### Query Performance

Check slow queries:

```sql
SELECT
  mean_exec_time,
  calls,
  query
FROM pg_stat_statements
WHERE query LIKE '%realtime_prices%' OR query LIKE '%forex_candles%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Flow Architecture                    │
└─────────────────────────────────────────────────────────────┘

1. Tick Ingestion (Every 5 seconds)
   ┌──────────────┐
   │ Polling      │──► realtime_prices table
   │ Coordinator  │    (Raw bid/ask ticks)
   └──────────────┘

2. Backend Aggregation (Every 5 minutes)
   ┌──────────────┐
   │ Supabase     │──► Query last 15min of ticks
   │ Cron Job     │──► Aggregate into OHLC candles
   └──────────────┘──► Save to forex_candles + market_data
                  └──► Log to candle_aggregation_log

3. Cleanup (Daily at 2 AM)
   ┌──────────────┐
   │ Cleanup      │──► Delete ticks > 24 hours old
   │ Cron Job     │    (After verifying candles exist)
   └──────────────┘

4. Browser Display (Real-time)
   ┌──────────────┐
   │ MarketChart  │──► Load historical candles
   │ Component    │──► Detect and backfill gaps
   └──────────────┘──► Update current candle from ticks
                  └──► Subscribe to new completed candles
```

## Benefits of This Approach

✅ **24/7 Data Continuity** - Candles created even when no users online
✅ **Reduced Browser Load** - No heavy aggregation in JavaScript
✅ **Faster Chart Loading** - Pre-aggregated data ready to display
✅ **Automatic Gap Filling** - Backfill from ticks when needed
✅ **Storage Efficiency** - 24-hour tick retention, infinite candle history
✅ **Easy Monitoring** - Built-in health checks and logs
✅ **Scalable** - Backend handles all symbols/timeframes efficiently

## Support and Maintenance

- Monitor `aggregation_health` view daily
- Check logs weekly for any recurring errors
- Verify cron jobs are executing on schedule
- Watch storage growth and adjust retention if needed
- Update timeframes/symbols in edge function as needed

---

**Last Updated**: 2025-11-03
**System Status**: ✅ Deployed and Ready for Cron Configuration
