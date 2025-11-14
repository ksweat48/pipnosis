/*
  # Add Missing Columns to forex_candles Table

  ## Overview
  This migration adds the `tick_volume` and `spread` columns to the forex_candles table
  to fix the chart loading error. The frontend code expects these columns when inserting
  candle data, but they were missing from the minimal schema.

  ## Changes
  1. Add `tick_volume` column (integer, default 0)
     - Tracks the number of ticks aggregated into each candle
     - Used for data quality assessment
  
  2. Add `spread` column (numeric, default 0)
     - Stores the bid-ask spread for the candle
     - Used for trading cost analysis

  ## Data Safety
  - Uses IF NOT EXISTS checks to prevent errors if columns already exist
  - Sets sensible defaults (0) for both columns
  - No data loss - only adds new columns to existing table
  - All existing candle records will have default values for new columns

  ## Security
  - No RLS policy changes needed
  - Inherits existing permissions from forex_candles table
*/

-- Add tick_volume column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'tick_volume'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN tick_volume integer DEFAULT 0;
    RAISE NOTICE 'Added tick_volume column to forex_candles';
  ELSE
    RAISE NOTICE 'tick_volume column already exists in forex_candles';
  END IF;
END $$;

-- Add spread column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'spread'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN spread numeric DEFAULT 0;
    RAISE NOTICE 'Added spread column to forex_candles';
  ELSE
    RAISE NOTICE 'spread column already exists in forex_candles';
  END IF;
END $$;

-- Add helpful index for tick_volume to support quality checks
CREATE INDEX IF NOT EXISTS idx_forex_candles_tick_volume
  ON forex_candles(tick_volume) WHERE tick_volume > 0;

-- Add table comment for documentation
COMMENT ON COLUMN forex_candles.tick_volume IS 'Number of price ticks aggregated into this candle. Higher values indicate more trading activity and data quality.';
COMMENT ON COLUMN forex_candles.spread IS 'Average bid-ask spread for this candle period. Used for trading cost analysis and slippage estimation.';
