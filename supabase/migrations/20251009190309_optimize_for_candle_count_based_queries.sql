/*
  # Optimize Database for Candle-Count-Based Queries

  ## Overview
  This migration optimizes the market_data table for efficient retrieval of the most recent N candles
  per symbol and timeframe. The system will now maintain exactly 500 candles per symbol-timeframe combination.

  ## Changes

  ### 1. Indexes for Efficient Last-N-Candles Queries
  - Add composite index (symbol, timeframe, timestamp DESC) for fast retrieval of recent candles
  - This enables efficient "SELECT ... ORDER BY timestamp DESC LIMIT 500" queries

  ### 2. Candle Count Tracking
  - Update market_data_completeness table to track candle counts instead of time ranges
  - Add expected_candles column (default 500)
  - Add actual_candles column to track current count
  - Add needs_backfill boolean for quick status checks

  ### 3. Helper Function
  - Create function to get the most recent N candles for a symbol-timeframe
  - Optimized for performance with proper index usage

  ## Performance Benefits
  - Direct LIMIT queries instead of time-range calculations
  - Predictable query performance regardless of data volume
  - Simplified data management with fixed-size datasets
  - Faster cache lookups with descending timestamp index
*/

-- Drop existing index if it exists and recreate with DESC order for optimization
DROP INDEX IF EXISTS idx_market_data_symbol_timeframe_timestamp;
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp_desc
  ON market_data(symbol, timeframe, timestamp DESC);

-- Add index specifically for getting latest candles (DESC order is critical)
CREATE INDEX IF NOT EXISTS idx_market_data_latest_candles
  ON market_data(symbol, timeframe, timestamp DESC, id);

-- Update market_data_completeness table structure for candle-count tracking
DO $$
BEGIN
  -- Add expected_candles column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data_completeness' AND column_name = 'expected_candles'
  ) THEN
    ALTER TABLE market_data_completeness ADD COLUMN expected_candles integer DEFAULT 500;
  END IF;

  -- Add actual_candles column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data_completeness' AND column_name = 'actual_candles'
  ) THEN
    ALTER TABLE market_data_completeness ADD COLUMN actual_candles integer DEFAULT 0;
  END IF;

  -- Add needs_backfill column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data_completeness' AND column_name = 'needs_backfill'
  ) THEN
    ALTER TABLE market_data_completeness ADD COLUMN needs_backfill boolean DEFAULT true;
  END IF;

  -- Add last_candle_timestamp for tracking the most recent candle
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data_completeness' AND column_name = 'last_candle_timestamp'
  ) THEN
    ALTER TABLE market_data_completeness ADD COLUMN last_candle_timestamp timestamptz;
  END IF;
END $$;

-- Function to efficiently get the most recent N candles for a symbol-timeframe
CREATE OR REPLACE FUNCTION get_recent_candles(
  p_symbol text,
  p_timeframe text,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  symbol text,
  timeframe text,
  candle_timestamp timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  tick_volume integer,
  spread integer,
  broker_time timestamptz,
  data_source text,
  is_complete boolean,
  completed_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    md.id,
    md.symbol,
    md.timeframe,
    md.timestamp,
    md.open,
    md.high,
    md.low,
    md.close,
    md.volume,
    md.tick_volume,
    md.spread,
    md.broker_time,
    md.data_source,
    md.is_complete,
    md.completed_at
  FROM market_data md
  WHERE md.symbol = p_symbol
    AND md.timeframe = p_timeframe
  ORDER BY md.timestamp DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update candle count statistics
CREATE OR REPLACE FUNCTION update_candle_count_stats(
  p_symbol text,
  p_timeframe text
)
RETURNS void AS $$
DECLARE
  v_count integer;
  v_last_timestamp timestamptz;
BEGIN
  -- Count total candles for this symbol-timeframe
  SELECT COUNT(*), MAX(timestamp)
  INTO v_count, v_last_timestamp
  FROM market_data
  WHERE symbol = p_symbol AND timeframe = p_timeframe;

  -- Update or insert completeness stats
  INSERT INTO market_data_completeness (
    symbol,
    timeframe,
    expected_candles,
    actual_candles,
    needs_backfill,
    last_candle_timestamp,
    last_validated,
    total_candles,
    backfill_status
  ) VALUES (
    p_symbol,
    p_timeframe,
    500,
    v_count,
    v_count < 500,
    v_last_timestamp,
    NOW(),
    v_count,
    CASE WHEN v_count >= 500 THEN 'complete' ELSE 'pending' END
  )
  ON CONFLICT (symbol, timeframe) DO UPDATE SET
    actual_candles = v_count,
    needs_backfill = v_count < 500,
    last_candle_timestamp = v_last_timestamp,
    last_validated = NOW(),
    total_candles = v_count,
    backfill_status = CASE WHEN v_count >= 500 THEN 'complete' ELSE 'pending' END;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old candles beyond the 500-candle limit
CREATE OR REPLACE FUNCTION cleanup_old_candles(
  p_symbol text,
  p_timeframe text,
  p_keep_count integer DEFAULT 500
)
RETURNS integer AS $$
DECLARE
  v_deleted_count integer;
  v_cutoff_timestamp timestamptz;
BEGIN
  -- Find the timestamp of the Nth most recent candle
  SELECT timestamp INTO v_cutoff_timestamp
  FROM market_data
  WHERE symbol = p_symbol AND timeframe = p_timeframe
  ORDER BY timestamp DESC
  OFFSET p_keep_count
  LIMIT 1;

  -- If we have more than p_keep_count candles, delete the old ones
  IF v_cutoff_timestamp IS NOT NULL THEN
    DELETE FROM market_data
    WHERE symbol = p_symbol
      AND timeframe = p_timeframe
      AND timestamp < v_cutoff_timestamp;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- Update stats after cleanup
    PERFORM update_candle_count_stats(p_symbol, p_timeframe);

    RETURN v_deleted_count;
  END IF;

  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the optimization
COMMENT ON FUNCTION get_recent_candles IS
'Efficiently retrieves the most recent N candles for a symbol-timeframe pair. Optimized with DESC index for fast queries.';

COMMENT ON FUNCTION update_candle_count_stats IS
'Updates the candle count statistics in market_data_completeness table for a specific symbol-timeframe.';

COMMENT ON FUNCTION cleanup_old_candles IS
'Removes candles older than the Nth most recent candle, maintaining a rolling window of the specified size (default 500).';
