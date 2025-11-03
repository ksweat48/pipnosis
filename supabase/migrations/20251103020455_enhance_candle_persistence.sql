/*
  # Enhance Candle Persistence for Chart

  1. Schema Updates
    - Add composite indexes for faster candle lookups
    - Add check constraints for data integrity
    - Optimize for chart initialization queries
    - Add function to clean duplicate candles

  2. Performance
    - Add covering indexes for common query patterns
    - Optimize for symbol + timeframe + time range queries

  3. Data Integrity
    - Ensure high >= low for all candles
    - Ensure open_time < close_time
    - Prevent invalid timestamps

  4. Security
    - RLS policies already exist (no changes needed)
*/

-- Ensure forex_candles table has proper constraints
DO $$
BEGIN
  -- Add check constraint for valid OHLC data
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'forex_candles_valid_high_low'
  ) THEN
    ALTER TABLE forex_candles
      ADD CONSTRAINT forex_candles_valid_high_low
      CHECK (high >= low);
  END IF;

  -- Add check constraint for valid time range
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'forex_candles_valid_time_range'
  ) THEN
    ALTER TABLE forex_candles
      ADD CONSTRAINT forex_candles_valid_time_range
      CHECK (close_time > open_time);
  END IF;

  -- Add check constraint for positive prices
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'forex_candles_positive_prices'
  ) THEN
    ALTER TABLE forex_candles
      ADD CONSTRAINT forex_candles_positive_prices
      CHECK (open > 0 AND high > 0 AND low > 0 AND close > 0);
  END IF;
END $$;

-- Add optimized composite index for chart queries (symbol, timeframe, time DESC)
CREATE INDEX IF NOT EXISTS idx_forex_candles_chart_query
  ON forex_candles(symbol, timeframe, open_time DESC)
  INCLUDE (open, high, low, close, volume);

-- Do the same for market_data table
DO $$
BEGIN
  -- Add check constraint for valid OHLC data
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_data_valid_high_low'
  ) THEN
    ALTER TABLE market_data
      ADD CONSTRAINT market_data_valid_high_low
      CHECK (high >= low);
  END IF;

  -- Add check constraint for positive prices
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_data_positive_prices'
  ) THEN
    ALTER TABLE market_data
      ADD CONSTRAINT market_data_positive_prices
      CHECK (open > 0 AND high > 0 AND low > 0 AND close > 0);
  END IF;
END $$;

-- Add optimized composite index for market_data chart queries
CREATE INDEX IF NOT EXISTS idx_market_data_chart_query
  ON market_data(symbol, timeframe, timestamp DESC)
  INCLUDE (open, high, low, close, volume);

-- Function to clean up duplicate candles (keeps the most recent version)
CREATE OR REPLACE FUNCTION cleanup_duplicate_candles()
RETURNS TABLE(
  deleted_count INTEGER,
  symbol TEXT,
  timeframe TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH duplicates AS (
    SELECT id, symbol, timeframe,
           ROW_NUMBER() OVER (
             PARTITION BY symbol, timeframe, open_time
             ORDER BY created_at DESC
           ) as rn
    FROM forex_candles
  )
  DELETE FROM forex_candles
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
  RETURNING 1, symbol, timeframe;
END;
$$ LANGUAGE plpgsql;

-- Function to validate candle data integrity
CREATE OR REPLACE FUNCTION validate_candle_integrity(
  p_symbol TEXT DEFAULT NULL,
  p_timeframe TEXT DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  symbol TEXT,
  timeframe TEXT,
  open_time TIMESTAMPTZ,
  issue TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    fc.id,
    fc.symbol,
    fc.timeframe,
    fc.open_time,
    CASE
      WHEN fc.high < fc.low THEN 'high < low'
      WHEN fc.open <= 0 THEN 'invalid open price'
      WHEN fc.high <= 0 THEN 'invalid high price'
      WHEN fc.low <= 0 THEN 'invalid low price'
      WHEN fc.close <= 0 THEN 'invalid close price'
      WHEN fc.close_time <= fc.open_time THEN 'close_time <= open_time'
      ELSE 'unknown issue'
    END as issue
  FROM forex_candles fc
  WHERE
    (p_symbol IS NULL OR fc.symbol = p_symbol)
    AND (p_timeframe IS NULL OR fc.timeframe = p_timeframe)
    AND (
      fc.high < fc.low
      OR fc.open <= 0
      OR fc.high <= 0
      OR fc.low <= 0
      OR fc.close <= 0
      OR fc.close_time <= fc.open_time
    );
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION cleanup_duplicate_candles() IS 'Removes duplicate candles keeping the most recent version based on created_at timestamp';
COMMENT ON FUNCTION validate_candle_integrity(TEXT, TEXT) IS 'Validates candle data integrity and returns any issues found';

-- Add indexes on realtime_prices for better aggregation performance
CREATE INDEX IF NOT EXISTS idx_realtime_prices_aggregation
  ON realtime_prices(symbol, created_at DESC)
  INCLUDE (bid, ask, broker_time);

CREATE INDEX IF NOT EXISTS idx_realtime_prices_broker_time
  ON realtime_prices(symbol, broker_time DESC)
  WHERE broker_time IS NOT NULL;
