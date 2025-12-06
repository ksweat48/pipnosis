-- Verify Historical Data Fix for Lower Timeframes
-- Run this in Supabase SQL Editor to check if the fix is working

-- 1. Count fake candles (should be 0 after cleanup)
SELECT
  'Fake Candles (Identical OHLC during closed market)' as check_name,
  symbol,
  timeframe,
  COUNT(*) as count
FROM forex_candles
WHERE
  open = high
  AND high = low
  AND low = close
  AND (
    EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 6 -- Saturday
    OR (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 5
        AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') >= 17) -- Friday after 5pm
    OR (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 0
        AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') < 17) -- Sunday before 5pm
  )
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- 2. Count all weekend candles (should be 0 after cleanup)
SELECT
  'All Weekend Candles (Should be 0)' as check_name,
  symbol,
  timeframe,
  COUNT(*) as count
FROM forex_candles
WHERE
  EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 6 -- Saturday
  OR (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 5
      AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') >= 17) -- Friday after 5pm
  OR (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 0
      AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') < 17) -- Sunday before 5pm
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- 3. Check M5 data availability (should have data from last 72 hours of open market)
SELECT
  'M5 Data Availability (Last 72 Hours)' as check_name,
  symbol,
  COUNT(*) as candle_count,
  MIN(open_time) as earliest_candle,
  MAX(open_time) as latest_candle,
  ROUND(EXTRACT(EPOCH FROM (MAX(open_time) - MIN(open_time))) / 3600, 1) as hours_covered
FROM forex_candles
WHERE
  timeframe IN ('M5', '5m')
  AND open_time >= NOW() - INTERVAL '72 hours'
GROUP BY symbol
ORDER BY symbol;

-- 4. Sample M5 candles to verify OHLC variation (should NOT be all identical)
SELECT
  'Sample M5 Candles (Should have different OHLC)' as check_name,
  symbol,
  open_time,
  open,
  high,
  low,
  close,
  CASE
    WHEN open = high AND high = low AND low = close THEN '⚠️ FAKE'
    ELSE '✓ Real'
  END as status
FROM forex_candles
WHERE
  timeframe IN ('M5', '5m')
  AND symbol = 'EURUSD'
  AND open_time >= NOW() - INTERVAL '24 hours'
ORDER BY open_time DESC
LIMIT 20;

-- 5. Check for proper candlestick data (wicks exist)
SELECT
  'Candles with Wicks (Should be most/all)' as check_name,
  symbol,
  timeframe,
  COUNT(*) as total_candles,
  COUNT(CASE WHEN high > open AND high > close THEN 1 END) as candles_with_upper_wick,
  COUNT(CASE WHEN low < open AND low < close THEN 1 END) as candles_with_lower_wick,
  ROUND(
    COUNT(CASE WHEN high > open AND high > close OR low < open AND low < close THEN 1 END)::numeric
    / NULLIF(COUNT(*), 0) * 100,
    1
  ) as pct_with_wicks
FROM forex_candles
WHERE
  timeframe IN ('M5', '5m', 'M1', '1m', 'M15', '15m')
  AND open_time >= NOW() - INTERVAL '24 hours'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- 6. Summary: Expected Results After Fix
/*
Expected Results After Running Cleanup:

1. Fake Candles: 0 rows (all removed)
2. Weekend Candles: 0 rows (all removed)
3. M5 Data Availability:
   - EURUSD: ~850+ candles covering ~72 hours
   - Other pairs: Similar counts
4. Sample M5 Candles: All marked as "✓ Real", different OHLC values
5. Candles with Wicks: >80% should have wicks

If you see different results, the fix may need adjustment.
*/
