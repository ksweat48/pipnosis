/*
  # Add Data Source Tracking to forex_candles

  1. Changes
    - Add `data_source` column to track candle origin
    - Add index for efficient querying by data source
    - Set default value for existing records

  2. Data Sources
    - 'tradingview': Historical data from TradingView backfill
    - 'metaapi': Live data from MetaAPI
    - 'aggregated': Real-time aggregated from ticks
    - 'manual': Manually inserted data

  3. Notes
    - Existing records will be set to 'metaapi' by default
    - New backfill will mark records as 'tradingview'
    - Helps track data provenance and quality
*/

-- Add data_source column to forex_candles table
ALTER TABLE forex_candles
ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'metaapi';

-- Create index for efficient filtering by data source
CREATE INDEX IF NOT EXISTS idx_forex_candles_data_source
  ON forex_candles(data_source);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_source
  ON forex_candles(symbol, timeframe, data_source);

-- Update existing records to have a data source (if they don't already)
UPDATE forex_candles
SET data_source = 'metaapi'
WHERE data_source IS NULL;

-- Add comment to column
COMMENT ON COLUMN forex_candles.data_source IS 
  'Source of candle data: tradingview, metaapi, aggregated, or manual';
