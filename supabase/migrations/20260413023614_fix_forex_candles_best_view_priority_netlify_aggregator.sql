/*
  # Fix forex_candles_best View — Prioritize Live Data Sources

  ## Problem
  The `forex_candles_best` view ranks data sources as follows:
    - metaapi        → priority 1 (highest)
    - dukascopy      → priority 2
    - twelve_data    → priority 3
    - browser_aggregated → priority 4
    - everything else → priority 5 (lowest) ← includes netlify_aggregator and metaapi_deadman

  This means the view DISCARDS freshly aggregated candles from the Netlify aggregator
  whenever an older candle from metaapi/dukascopy/twelve_data exists for the same
  symbol/timeframe/open_time. The new candle is saved to the DB but hidden by the view.

  ## Fix
  Reorder priorities so that live-built candles take precedence:
    - netlify_aggregator → priority 1 (tick-built, most accurate)
    - metaapi_deadman    → priority 2 (gap-fill, also fresh)
    - metaapi            → priority 3 (broker API, good quality)
    - dukascopy          → priority 4
    - twelve_data        → priority 5
    - browser_aggregated → priority 6
    - everything else    → priority 7

  ## Impact
  - Charts will now show the most recently aggregated candles
  - Candles built from live tick data (netlify_aggregator) will no longer be hidden
  - No data is deleted — only the view priority ordering changes
*/

CREATE OR REPLACE VIEW forex_candles_best
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (symbol, timeframe, open_time)
  id,
  symbol,
  timeframe,
  open_time,
  close_time,
  open,
  high,
  low,
  close,
  volume,
  tick_volume,
  spread,
  data_source,
  created_at,
  tick_count,
  quality_score,
  deprecated,
  is_flat_candle
FROM forex_candles
WHERE
  high >= low
  AND open >= low
  AND open <= high
  AND close >= low
  AND close <= high
  AND (is_flat_candle = false OR is_flat_candle IS NULL)
  AND (deprecated = false OR deprecated IS NULL)
  AND open > 0
  AND high > 0
  AND low > 0
  AND close > 0
ORDER BY
  symbol,
  timeframe,
  open_time,
  CASE
    WHEN data_source = 'netlify_aggregator' THEN 1
    WHEN data_source = 'metaapi_deadman'    THEN 2
    WHEN data_source = 'metaapi'            THEN 3
    WHEN data_source = 'dukascopy'          THEN 4
    WHEN data_source = 'twelve_data'        THEN 5
    WHEN data_source = 'browser_aggregated' THEN 6
    ELSE 7
  END,
  quality_score DESC NULLS LAST,
  created_at DESC;
