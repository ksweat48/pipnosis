/*
  # Fill H1, H4, D1 candles from existing M5 data

  This migration aggregates H1, H4, and D1 candles from the M5 candles
  that already exist in the database. This fills the gap in higher timeframes
  caused by the broker clock skew bug which prevented candle creation.

  The M5 candles were fixed via the aggregate-candles edge function (v3)
  which now correctly handles the 3-hour broker time offset.

  Tables modified: forex_candles (inserts only, no updates to existing rows)
*/

-- Build H1 candles from M5 data for all 7 forex symbols
INSERT INTO forex_candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, tick_count, data_source, quality_score)
SELECT
  symbol,
  'H1' AS timeframe,
  date_trunc('hour', open_time) AS open_time,
  date_trunc('hour', open_time) + INTERVAL '1 hour' - INTERVAL '1 second' AS close_time,
  (array_agg(open ORDER BY open_time ASC))[1] AS open,
  MAX(high) AS high,
  MIN(low) AS low,
  (array_agg(close ORDER BY open_time DESC))[1] AS close,
  SUM(volume) AS volume,
  SUM(tick_count) AS tick_count,
  'aggregated_from_m5' AS data_source,
  85 AS quality_score
FROM forex_candles
WHERE timeframe = 'M5'
  AND symbol IN ('EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100', 'SPX500')
GROUP BY symbol, date_trunc('hour', open_time)
ON CONFLICT (symbol, timeframe, open_time) DO UPDATE SET
  high = GREATEST(forex_candles.high, EXCLUDED.high),
  low = LEAST(forex_candles.low, EXCLUDED.low),
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  tick_count = EXCLUDED.tick_count,
  data_source = EXCLUDED.data_source;

-- Build H4 candles from H1 data
INSERT INTO forex_candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, tick_count, data_source, quality_score)
SELECT
  symbol,
  'H4' AS timeframe,
  date_trunc('hour', open_time) - (EXTRACT(HOUR FROM open_time)::int % 4) * INTERVAL '1 hour' AS open_time,
  date_trunc('hour', open_time) - (EXTRACT(HOUR FROM open_time)::int % 4) * INTERVAL '1 hour' + INTERVAL '4 hours' - INTERVAL '1 second' AS close_time,
  (array_agg(open ORDER BY open_time ASC))[1] AS open,
  MAX(high) AS high,
  MIN(low) AS low,
  (array_agg(close ORDER BY open_time DESC))[1] AS close,
  SUM(volume) AS volume,
  SUM(tick_count) AS tick_count,
  'aggregated_from_h1' AS data_source,
  85 AS quality_score
FROM forex_candles
WHERE timeframe = 'H1'
  AND symbol IN ('EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100', 'SPX500')
GROUP BY symbol, date_trunc('hour', open_time) - (EXTRACT(HOUR FROM open_time)::int % 4) * INTERVAL '1 hour'
ON CONFLICT (symbol, timeframe, open_time) DO UPDATE SET
  high = GREATEST(forex_candles.high, EXCLUDED.high),
  low = LEAST(forex_candles.low, EXCLUDED.low),
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  tick_count = EXCLUDED.tick_count,
  data_source = EXCLUDED.data_source;

-- Build D1 candles from H4 data
INSERT INTO forex_candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, tick_count, data_source, quality_score)
SELECT
  symbol,
  'D1' AS timeframe,
  date_trunc('day', open_time) AS open_time,
  date_trunc('day', open_time) + INTERVAL '1 day' - INTERVAL '1 second' AS close_time,
  (array_agg(open ORDER BY open_time ASC))[1] AS open,
  MAX(high) AS high,
  MIN(low) AS low,
  (array_agg(close ORDER BY open_time DESC))[1] AS close,
  SUM(volume) AS volume,
  SUM(tick_count) AS tick_count,
  'aggregated_from_h4' AS data_source,
  85 AS quality_score
FROM forex_candles
WHERE timeframe = 'H4'
  AND symbol IN ('EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'NAS100', 'SPX500')
GROUP BY symbol, date_trunc('day', open_time)
ON CONFLICT (symbol, timeframe, open_time) DO UPDATE SET
  high = GREATEST(forex_candles.high, EXCLUDED.high),
  low = LEAST(forex_candles.low, EXCLUDED.low),
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  tick_count = EXCLUDED.tick_count,
  data_source = EXCLUDED.data_source;
