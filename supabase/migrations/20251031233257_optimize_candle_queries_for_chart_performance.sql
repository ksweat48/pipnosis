/*
  # Optimize Candle Data Queries for Chart Performance

  1. Purpose
    - Add indexes to forex_candles and market_data tables for fast retrieval
    - Optimize queries for loading chart data without time-lapse effect
    - Support instant chart loading with pre-aggregated candle data

  2. New Indexes
    - forex_candles: composite index on (symbol, timeframe, open_time DESC)
    - market_data: composite index on (symbol, timeframe, timestamp DESC)
    - Both indexes support fast retrieval of latest N candles for any symbol/timeframe

  3. Performance Impact
    - Enables instant loading of chart data (no client-side aggregation)
    - Supports efficient ORDER BY with LIMIT queries
    - Dramatically reduces query time for large datasets
    
  4. Notes
    - Uses IF NOT EXISTS to allow safe re-runs
    - Indexes are critical for professional trading platform performance
    - DESC ordering supports "get latest N candles" pattern
*/

-- Add performance index for forex_candles table
CREATE INDEX IF NOT EXISTS idx_forex_candles_chart_query 
ON forex_candles(symbol, timeframe, open_time DESC);

-- Add performance index for market_data table
CREATE INDEX IF NOT EXISTS idx_market_data_chart_query 
ON market_data(symbol, timeframe, timestamp DESC);

-- Add index for realtime_prices to speed up current candle aggregation
CREATE INDEX IF NOT EXISTS idx_realtime_prices_recent 
ON realtime_prices(symbol, created_at DESC);

-- Add index to support broker_time queries
CREATE INDEX IF NOT EXISTS idx_realtime_prices_broker_time 
ON realtime_prices(symbol, broker_time DESC) 
WHERE broker_time IS NOT NULL;