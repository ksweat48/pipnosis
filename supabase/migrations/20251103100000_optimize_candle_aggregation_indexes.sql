/*
  # Optimize Candle Aggregation Performance

  1. Performance Improvements
    - Add composite indexes for fast candle lookups by symbol, timeframe, and time
    - Add indexes for realtime_prices to speed up recent price queries
    - Add covering indexes to reduce disk I/O
    - Add partial indexes for active trading pairs

  2. Changes
    - forex_candles: composite index on (symbol, timeframe, open_time DESC)
    - market_data: composite index on (symbol, timeframe, timestamp DESC)
    - realtime_prices: composite index on (symbol, created_at DESC)
    - realtime_prices: partial index for recent data (last 24 hours)

  3. Benefits
    - Faster chart loading across all timeframes
    - Faster background candle aggregation
    - Reduced database load during multi-pair queries
    - Optimized for real-time price updates
*/

-- Drop existing indexes if they exist to recreate with better configuration
DROP INDEX IF EXISTS idx_forex_candles_symbol_timeframe_time;
DROP INDEX IF EXISTS idx_market_data_symbol_timeframe_time;
DROP INDEX IF EXISTS idx_realtime_prices_symbol_time;
DROP INDEX IF EXISTS idx_realtime_prices_recent;

-- Forex candles: optimized for fetching candles by symbol, timeframe, and time range
-- This is the primary index for chart data queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_lookup
ON forex_candles (symbol, timeframe, open_time DESC);

-- Forex candles: covering index for quick latest candle queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_latest
ON forex_candles (symbol, timeframe, open_time DESC)
INCLUDE (open, high, low, close, volume);

-- Market data: optimized for multi-timeframe queries
CREATE INDEX IF NOT EXISTS idx_market_data_lookup
ON market_data (symbol, timeframe, timestamp DESC);

-- Market data: covering index for quick latest data
CREATE INDEX IF NOT EXISTS idx_market_data_latest
ON market_data (symbol, timeframe, timestamp DESC)
INCLUDE (open, high, low, close, volume);

-- Realtime prices: optimized for recent price queries
CREATE INDEX IF NOT EXISTS idx_realtime_prices_lookup
ON realtime_prices (symbol, created_at DESC);

-- Realtime prices: covering index for price aggregation
CREATE INDEX IF NOT EXISTS idx_realtime_prices_aggregation
ON realtime_prices (symbol, created_at DESC)
INCLUDE (bid, ask, broker_time);

-- Realtime prices: partial index for very recent data (last 24 hours)
-- This speeds up current candle aggregation significantly
CREATE INDEX IF NOT EXISTS idx_realtime_prices_recent_24h
ON realtime_prices (symbol, created_at DESC)
WHERE created_at > (now() - interval '24 hours');

-- Add index for broker_time to handle queries using that column
CREATE INDEX IF NOT EXISTS idx_realtime_prices_broker_time
ON realtime_prices (symbol, broker_time DESC)
WHERE broker_time IS NOT NULL;

-- Optimize for timeframe-specific queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_by_timeframe
ON forex_candles (timeframe, symbol, open_time DESC);

-- Create statistics for query planner optimization
ANALYZE forex_candles;
ANALYZE market_data;
ANALYZE realtime_prices;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Candle aggregation indexes created successfully';
  RAISE NOTICE 'Query performance should be significantly improved';
END $$;
