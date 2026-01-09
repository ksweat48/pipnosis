/*
  # Create forex_candles_best Quality View

  ## Summary
  Creates the missing `forex_candles_best` view that provides automatic
  data quality filtering and source prioritization for chart data.

  ## Purpose
  This view was referenced in the codebase but never actually created,
  causing chart queries to timeout. The view filters out invalid candles
  and prioritizes higher-quality data sources.

  ## Quality Filters
  1. Removes invalid OHLC candles (high < low, values outside range)
  2. Removes flat candles (open = high = low = close)
  3. Removes deprecated candles
  4. Prioritizes MetaAPI data over browser-aggregated data
  5. Deduplicates by (symbol, timeframe, open_time)

  ## Performance
  - Uses existing indexes on forex_candles table
  - Lightweight filtering, no aggregation
  - Query planner can push down predicates efficiently

  ## Schema
  Returns same columns as forex_candles table for drop-in compatibility
*/

-- Drop existing view if it exists
DROP VIEW IF EXISTS forex_candles_best CASCADE;

-- Create the quality-filtered view
CREATE VIEW forex_candles_best AS
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
  -- Quality Filter 1: Valid OHLC relationships
  high >= low
  AND open >= low AND open <= high
  AND close >= low AND close <= high

  -- Quality Filter 2: Not a flat candle (use is_flat_candle flag if available)
  AND (is_flat_candle = false OR is_flat_candle IS NULL)

  -- Quality Filter 3: Not deprecated
  AND (deprecated = false OR deprecated IS NULL)

  -- Quality Filter 4: Has valid price data
  AND open > 0 AND high > 0 AND low > 0 AND close > 0

-- Prioritization: MetaAPI first, then others, newest first
ORDER BY
  symbol,
  timeframe,
  open_time,
  CASE
    WHEN data_source = 'metaapi' THEN 1
    WHEN data_source = 'dukascopy' THEN 2
    WHEN data_source = 'twelve_data' THEN 3
    WHEN data_source = 'browser_aggregated' THEN 4
    ELSE 5
  END,
  quality_score DESC NULLS LAST,
  created_at DESC;

-- Add comment for documentation
COMMENT ON VIEW forex_candles_best IS
  'Quality-filtered candle data with automatic source prioritization. '
  'Filters out invalid OHLC data, flat candles, deprecated data, and prioritizes MetaAPI over other sources.';

-- Grant permissions
GRANT SELECT ON forex_candles_best TO authenticated;
GRANT SELECT ON forex_candles_best TO anon;

-- Note: View automatically uses existing indexes on forex_candles:
-- - idx_candles_symbol_timeframe_open_time (from migration 20251224080612)
-- - idx_forex_candles_crypto_symbol_time (from migration 20251227092112)
