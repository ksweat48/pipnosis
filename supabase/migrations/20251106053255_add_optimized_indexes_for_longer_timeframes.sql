/*
  # Optimize Indexes for Daily and Weekly Timeframes

  ## Summary
  This migration adds optimized indexes and validation for H4, D1, and W1 timeframes to ensure
  efficient querying and proper data integrity for longer timeframe analysis.

  ## Changes
  1. **Indexes**: Add composite indexes optimized for longer timeframe queries
     - Index on (symbol, timeframe, open_time DESC) for efficient historical data retrieval
     - Partial indexes for specific longer timeframes to speed up queries
  
  2. **Validation**: Add check constraint to ensure timeframe values are valid
  
  3. **Performance**: These indexes will significantly improve chart loading performance
     for daily and weekly views, especially when fetching 200-500 candles

  ## Impact
  - Improved query performance for D1 and W1 charts
  - Better support for historical data analysis on longer timeframes
  - No breaking changes to existing functionality
*/

-- Create optimized composite index for longer timeframes if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_time_desc 
ON forex_candles(symbol, timeframe, open_time DESC);

-- Create partial index specifically for daily candles (most common long timeframe)
CREATE INDEX IF NOT EXISTS idx_forex_candles_daily 
ON forex_candles(symbol, open_time DESC) 
WHERE timeframe = 'D1';

-- Create partial index for weekly candles
CREATE INDEX IF NOT EXISTS idx_forex_candles_weekly 
ON forex_candles(symbol, open_time DESC) 
WHERE timeframe = 'W1';

-- Create partial index for 4-hour candles
CREATE INDEX IF NOT EXISTS idx_forex_candles_4hour 
ON forex_candles(symbol, open_time DESC) 
WHERE timeframe = 'H4';

-- Add check constraint to validate timeframe values
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_timeframe_check'
  ) THEN
    ALTER TABLE forex_candles 
    ADD CONSTRAINT valid_timeframe_check 
    CHECK (timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'));
  END IF;
END $$;

-- Create index for timeframe-specific queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_timeframe 
ON forex_candles(timeframe);

-- Add comment to document the optimization
COMMENT ON INDEX idx_forex_candles_symbol_timeframe_time_desc IS 
'Composite index optimized for fetching historical candles by symbol and timeframe in descending time order. Critical for chart performance on D1 and W1 timeframes.';

COMMENT ON INDEX idx_forex_candles_daily IS 
'Partial index for daily (D1) candle queries. Improves performance when loading daily charts.';

COMMENT ON INDEX idx_forex_candles_weekly IS 
'Partial index for weekly (W1) candle queries. Improves performance when loading weekly charts.';

COMMENT ON INDEX idx_forex_candles_4hour IS 
'Partial index for 4-hour (H4) candle queries. Improves performance when loading 4-hour charts.';
