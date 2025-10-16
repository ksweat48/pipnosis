/*
  # Add Candle Completion Tracking

  ## Overview
  This migration adds completion tracking to the market_data table to distinguish
  between incomplete candles (being built from live ticks) and complete historical candles.

  ## Changes
  
  1. New Columns
    - `is_complete` (boolean) - Indicates if the candle period has closed
    - `completed_at` (timestamptz) - When the candle was marked as complete
  
  2. Indexes
    - Add index on (symbol, timeframe, is_complete) for faster queries of incomplete candles
    - Add index on completed_at for time-based queries
  
  3. Data Migration
    - Set all existing candles as complete (they are historical data)
    - Set completed_at to created_at for existing records

  ## Purpose
  This allows the system to:
  - Track which candles are still being built from live ticks
  - Query for recent complete candles on chart refresh
  - Merge live and historical data seamlessly
  - Recover incomplete candles across page refreshes
*/

-- Add new columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data' AND column_name = 'is_complete'
  ) THEN
    ALTER TABLE market_data ADD COLUMN is_complete boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE market_data ADD COLUMN completed_at timestamptz;
  END IF;
END $$;

-- Set completed_at for existing records
UPDATE market_data
SET completed_at = created_at
WHERE completed_at IS NULL AND is_complete = true;

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_complete
  ON market_data(symbol, timeframe, is_complete);

CREATE INDEX IF NOT EXISTS idx_market_data_completed_at
  ON market_data(completed_at DESC) WHERE completed_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN market_data.is_complete IS 'Indicates if the candle period has closed and the candle is finalized';
COMMENT ON COLUMN market_data.completed_at IS 'Timestamp when the candle was marked as complete';
