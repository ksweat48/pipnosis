/*
  # Performance Optimization Indexes

  1. Purpose
    - Add indexes to market_data table for faster chart data retrieval
    - Optimize queries by symbol, timeframe, and timestamp
    - Reduce chart load times from 15+ seconds to under 2 seconds

  2. New Indexes
    - Composite index on (symbol, timeframe, timestamp DESC) for historical data queries
    - Individual indexes on frequently queried columns
    - Partial indexes for data_source filtering

  3. Performance Impact
    - Expected 10-20x improvement in query speed for historical candle fetching
    - Reduced I/O operations through index-only scans
    - Faster sorting and filtering operations
*/

-- Create composite index for the most common query pattern
-- This covers queries like: SELECT * FROM market_data WHERE symbol = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT 500
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp
ON market_data(symbol, timeframe, timestamp DESC);

-- Create index for data source filtering
-- Useful for distinguishing between live_tick and metaapi data
CREATE INDEX IF NOT EXISTS idx_market_data_data_source
ON market_data(data_source)
WHERE data_source IS NOT NULL;

-- Note: Partial index with NOW() cannot be created due to immutability constraint
-- The composite index above will handle all queries efficiently

-- Create index on updated_at for cache freshness checks
CREATE INDEX IF NOT EXISTS idx_market_data_updated_at
ON market_data(updated_at DESC);

-- Analyze the table to update statistics for the query planner
ANALYZE market_data;

-- Add comments for documentation
COMMENT ON INDEX idx_market_data_symbol_timeframe_timestamp IS 'Primary composite index for fast historical data retrieval by symbol and timeframe';
COMMENT ON INDEX idx_market_data_data_source IS 'Index for filtering by data source type';
COMMENT ON INDEX idx_market_data_updated_at IS 'Index for cache freshness validation queries';