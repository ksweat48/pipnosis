-- =====================================================
-- SETUP CANDLE AGGREGATION SYSTEM
-- Complete SQL script for setting up automated candle persistence
-- =====================================================

-- BEFORE RUNNING THIS SCRIPT:
-- 1. Replace YOUR_PROJECT_REF with your Supabase project reference
--    (Found in: Settings → General → Reference ID)
-- 2. Replace YOUR_SERVICE_ROLE_KEY with your service role key
--    (Found in: Settings → API → service_role key)
-- =====================================================

-- Step 1: Enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Step 2: Create the main aggregation cron job (runs every 5 minutes)
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

-- Step 3: (Optional) Create daily cleanup job to remove old ticks
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

-- =====================================================
-- VERIFICATION QUERIES
-- Run these after setup to verify everything is working
-- =====================================================

-- Verify cron jobs were created
SELECT
  jobid,
  jobname,
  schedule,
  active,
  created_at
FROM cron.job
WHERE jobname IN ('aggregate-candles-every-5-minutes', 'cleanup-old-ticks-daily')
ORDER BY jobname;

-- Check recent aggregation runs (wait 5-10 minutes after setup)
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

-- Verify candles are being created for all symbols and timeframes
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MAX(open_time) as latest_candle
FROM forex_candles
WHERE open_time >= NOW() - INTERVAL '2 hours'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- =====================================================
-- TROUBLESHOOTING QUERIES
-- =====================================================

-- Check cron job execution details
SELECT
  start_time,
  end_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid = (
  SELECT jobid FROM cron.job
  WHERE jobname = 'aggregate-candles-every-5-minutes'
)
ORDER BY start_time DESC
LIMIT 10;

-- Verify tick data is being collected
SELECT
  symbol,
  COUNT(*) as tick_count,
  MAX(created_at) as latest_tick
FROM realtime_prices
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY symbol
ORDER BY symbol;

-- Quick health check
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
  COUNT(DISTINCT symbol)::text || ' symbols with recent data' as status
FROM forex_candles
WHERE open_time >= NOW() - INTERVAL '1 hour';

-- =====================================================
-- MANAGEMENT QUERIES
-- =====================================================

-- Pause the aggregation job (if needed)
-- UPDATE cron.job
-- SET active = false
-- WHERE jobname = 'aggregate-candles-every-5-minutes';

-- Resume the aggregation job
-- UPDATE cron.job
-- SET active = true
-- WHERE jobname = 'aggregate-candles-every-5-minutes';

-- Delete and recreate job (if needed)
-- SELECT cron.unschedule('aggregate-candles-every-5-minutes');
-- Then run the schedule command again from Step 2

-- =====================================================
-- Expected Results After Setup:
-- 1. Two cron jobs should appear in cron.job table
-- 2. After 5-10 minutes, entries appear in candle_aggregation_log
-- 3. Candles being created for all 12 symbols × 8 timeframes
-- 4. Charts in app show continuous data with no gaps
-- =====================================================
