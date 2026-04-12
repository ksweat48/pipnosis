/*
  # Backfill BTC/ETH forming candles from realtime_prices

  ## Problem
  The continuous-candle-aggregator Netlify function stopped running ~4 hours ago.
  The forex_candles table (read via forex_candles_best view) has no BTC/ETH data
  since 2026-04-11 23:50 UTC (~4 hours stale).

  The chart's historicalCandlesRef is therefore 4 hours behind, which causes the
  tick-rejection guard in updateCurrentCandleFromTick to block ALL live Kraken ticks
  (since the current candle slot is far newer than lastHistoricalTime).

  ## Fix
  1. Build completed M1/M5 candles for all completed periods between the last saved
     candle and NOW using the available realtime_prices ticks (the last ~16 minutes).
  2. This gives the chart a recent baseline so live ticks are accepted.

  ## Note
  The 4-hour gap cannot be backfilled because realtime_prices is cleaned up hourly
  and only contains recent ticks. The gap will remain in the historical chart but 
  the live candle will work correctly going forward.
*/

-- Step 1: Build M1 candles from current realtime_prices ticks for BTCUSD
INSERT INTO forex_candles (
  symbol, timeframe, open_time, close_time, open, high, low, close, volume, tick_count, data_source, quality_score
)
SELECT
  symbol,
  'M1' AS timeframe,
  date_trunc('minute', broker_time) AS open_time,
  date_trunc('minute', broker_time) + interval '1 minute' AS close_time,
  (array_agg((bid::numeric + ask::numeric) / 2 ORDER BY broker_time ASC))[1] AS open,
  MAX((bid::numeric + ask::numeric) / 2) AS high,
  MIN((bid::numeric + ask::numeric) / 2) AS low,
  (array_agg((bid::numeric + ask::numeric) / 2 ORDER BY broker_time DESC))[1] AS close,
  COUNT(*) AS volume,
  COUNT(*) AS tick_count,
  'netlify_aggregator' AS data_source,
  90 AS quality_score
FROM realtime_prices
WHERE symbol IN ('BTCUSD', 'ETHUSD')
  AND broker_time < date_trunc('minute', NOW())
GROUP BY symbol, date_trunc('minute', broker_time)
HAVING COUNT(*) >= 2
ON CONFLICT (symbol, timeframe, open_time) DO UPDATE SET
  high = GREATEST(EXCLUDED.high, forex_candles.high),
  low = LEAST(EXCLUDED.low, forex_candles.low),
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  tick_count = EXCLUDED.tick_count,
  quality_score = GREATEST(EXCLUDED.quality_score, forex_candles.quality_score);

-- Step 2: Build M5 candles by aggregating the M1 candles we just created
INSERT INTO forex_candles (
  symbol, timeframe, open_time, close_time, open, high, low, close, volume, tick_count, data_source, quality_score
)
SELECT
  symbol,
  'M5' AS timeframe,
  date_trunc('hour', open_time) + INTERVAL '5 minutes' * FLOOR(EXTRACT(MINUTE FROM open_time) / 5) AS open_time,
  date_trunc('hour', open_time) + INTERVAL '5 minutes' * FLOOR(EXTRACT(MINUTE FROM open_time) / 5) + INTERVAL '5 minutes' AS close_time,
  (array_agg(open ORDER BY open_time ASC))[1] AS open,
  MAX(high) AS high,
  MIN(low) AS low,
  (array_agg(close ORDER BY open_time DESC))[1] AS close,
  SUM(volume) AS volume,
  SUM(tick_count) AS tick_count,
  'netlify_aggregator' AS data_source,
  90 AS quality_score
FROM forex_candles
WHERE symbol IN ('BTCUSD', 'ETHUSD')
  AND timeframe = 'M1'
  AND open_time >= NOW() - INTERVAL '30 minutes'
  AND open_time < date_trunc('hour', NOW()) + INTERVAL '5 minutes' * FLOOR(EXTRACT(MINUTE FROM NOW()) / 5)
  AND (is_flat_candle IS NULL OR is_flat_candle = false)
GROUP BY 
  symbol,
  date_trunc('hour', open_time) + INTERVAL '5 minutes' * FLOOR(EXTRACT(MINUTE FROM open_time) / 5)
HAVING COUNT(*) >= 2
ON CONFLICT (symbol, timeframe, open_time) DO UPDATE SET
  high = GREATEST(EXCLUDED.high, forex_candles.high),
  low = LEAST(EXCLUDED.low, forex_candles.low),
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  tick_count = EXCLUDED.tick_count,
  quality_score = GREATEST(EXCLUDED.quality_score, forex_candles.quality_score);

-- Log that we ran this backfill
INSERT INTO candle_aggregation_log (executed_at, status, ticks_processed, candles_created, symbols_processed, duration_ms, message)
VALUES (NOW(), 'success', 0, 0, 2, 0, 'Manual backfill migration: built M1/M5 forming candles for BTCUSD/ETHUSD from realtime_prices ticks');
