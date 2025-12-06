-- CRITICAL: Clean up fake candles from closed market periods
-- This script removes candles that were created during Saturday, Friday after 5pm EST, and Sunday before 5pm EST
-- These candles have identical OHLC values and should not exist

-- Step 1: Identify candles with identical OHLC values (likely fake/reconstructed)
-- These occur when market is closed and system incorrectly creates candles
SELECT
  symbol,
  timeframe,
  COUNT(*) as fake_candle_count,
  MIN(open_time) as earliest_fake,
  MAX(open_time) as latest_fake
FROM forex_candles
WHERE
  open = high
  AND high = low
  AND low = close
  AND (
    -- Saturday (all day)
    EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 6
    OR
    -- Friday after 5pm EST
    (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 5
     AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') >= 17)
    OR
    -- Sunday before 5pm EST
    (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 0
     AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') < 17)
  )
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- Step 2: Delete fake candles from closed market periods
-- SAFETY: This only deletes candles where OHLC are identical (fake data) during closed market hours
DELETE FROM forex_candles
WHERE
  open = high
  AND high = low
  AND low = close
  AND (
    -- Saturday (all day)
    EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 6
    OR
    -- Friday after 5pm EST
    (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 5
     AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') >= 17)
    OR
    -- Sunday before 5pm EST
    (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 0
     AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') < 17)
  );

-- Step 3: Verify cleanup
SELECT
  symbol,
  timeframe,
  COUNT(*) as remaining_weekend_candles
FROM forex_candles
WHERE
  -- Saturday (all day)
  EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 6
  OR
  -- Friday after 5pm EST
  (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 5
   AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') >= 17)
  OR
  -- Sunday before 5pm EST
  (EXTRACT(DOW FROM open_time AT TIME ZONE 'America/New_York') = 0
   AND EXTRACT(HOUR FROM open_time AT TIME ZONE 'America/New_York') < 17)
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
