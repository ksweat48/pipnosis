-- Quick SQL queries to check candle storage status
-- Run these in Supabase SQL Editor

-- 1. Check recent candles (last 24 hours)
SELECT
  data_source,
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MAX(created_at) as latest_candle,
  MIN(created_at) as earliest_candle
FROM forex_candles
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY data_source, symbol, timeframe
ORDER BY latest_candle DESC;

-- 2. Check validation failures (last 24 hours)
SELECT
  symbol,
  validation_type,
  error_message,
  severity,
  candle_data,
  occurred_at
FROM candle_validation_failures
WHERE occurred_at >= NOW() - INTERVAL '24 hours'
ORDER BY occurred_at DESC
LIMIT 50;

-- 3. Check total candles per symbol
SELECT
  symbol,
  timeframe,
  COUNT(*) as total_candles,
  MIN(open_time) as earliest_data,
  MAX(open_time) as latest_data,
  MAX(created_at) as last_stored
FROM forex_candles
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- 4. Check data freshness
SELECT
  symbol,
  timeframe,
  open_time,
  close_time,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))/60 as age_minutes,
  data_source
FROM forex_candles
ORDER BY created_at DESC
LIMIT 20;

-- 5. Check for gaps in data (missing candles)
WITH candle_times AS (
  SELECT
    symbol,
    timeframe,
    open_time,
    LEAD(open_time) OVER (PARTITION BY symbol, timeframe ORDER BY open_time) as next_open_time,
    CASE timeframe
      WHEN '1m' THEN INTERVAL '1 minute'
      WHEN '5m' THEN INTERVAL '5 minutes'
      WHEN '15m' THEN INTERVAL '15 minutes'
      WHEN '1h' THEN INTERVAL '1 hour'
      WHEN '4h' THEN INTERVAL '4 hours'
      WHEN '1d' THEN INTERVAL '1 day'
    END as expected_gap
  FROM forex_candles
  WHERE created_at >= NOW() - INTERVAL '24 hours'
)
SELECT
  symbol,
  timeframe,
  open_time,
  next_open_time,
  EXTRACT(EPOCH FROM (next_open_time - open_time - expected_gap))/60 as gap_minutes
FROM candle_times
WHERE next_open_time IS NOT NULL
  AND (next_open_time - open_time) > expected_gap * 1.5
ORDER BY symbol, timeframe, open_time
LIMIT 50;

-- 6. Check aggregator source candles specifically
SELECT
  symbol,
  timeframe,
  COUNT(*) as count,
  MAX(created_at) as last_created
FROM forex_candles
WHERE data_source = 'netlify_aggregator'
GROUP BY symbol, timeframe
ORDER BY last_created DESC;
