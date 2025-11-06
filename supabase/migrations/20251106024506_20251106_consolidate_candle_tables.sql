/*
  # Consolidate Candle Data Tables

  ## Summary
  This migration consolidates all historical candle data into a single table (`forex_candles`)
  to eliminate duplicate data storage and fix overlapping candle issues.

  ## Problem
  The system had three separate tables storing the same candle data:
  - `forex_candles` (primary table)
  - `historical_candles` (unused duplicate)
  - `market_data` (redundant duplicate)

  This caused race conditions and duplicate/overlapping data in charts.

  ## Changes

  ### Tables Dropped
  1. `historical_candles` - Not actively used, redundant with forex_candles
  2. `market_data` - Redundant duplicate of forex_candles data

  ### Tables Retained
  - `forex_candles` - Primary table for all historical candle data
    - Has proper unique constraint: (symbol, timeframe, open_time)
    - Optimized indexes for fast queries
    - Clean, simple structure

  ## Security
  - No changes to RLS policies on forex_candles
  - Maintains existing authenticated read access

  ## Important Notes
  - After this migration, all candle data should be written ONLY to forex_candles
  - Application code must be updated to remove writes to market_data
  - The forex_candles table remains the single source of truth
*/

-- Drop the historical_candles table if it exists
DROP TABLE IF EXISTS historical_candles CASCADE;

-- Drop the market_data table if it exists
DROP TABLE IF EXISTS market_data CASCADE;

-- Drop market_data_subscriptions table if it exists (related to market_data)
DROP TABLE IF EXISTS market_data_subscriptions CASCADE;

-- Drop any related functions for market_data
DROP FUNCTION IF EXISTS get_historical_candle_stats(text, text) CASCADE;
DROP FUNCTION IF EXISTS check_historical_candles_exist(text, text, timestamptz, timestamptz) CASCADE;

-- Verify forex_candles table has correct structure
-- (This is idempotent - only creates if not exists)
DO $$
BEGIN
  -- Ensure unique constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'forex_candles_symbol_timeframe_open_time_key'
  ) THEN
    ALTER TABLE forex_candles 
    ADD CONSTRAINT forex_candles_symbol_timeframe_open_time_key 
    UNIQUE(symbol, timeframe, open_time);
  END IF;
END $$;

-- Ensure optimal indexes exist on forex_candles
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_open_time
  ON forex_candles(symbol, timeframe, open_time DESC);

CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol
  ON forex_candles(symbol);

CREATE INDEX IF NOT EXISTS idx_forex_candles_timeframe
  ON forex_candles(timeframe);

CREATE INDEX IF NOT EXISTS idx_forex_candles_created_at
  ON forex_candles(created_at DESC);

-- Add comment to forex_candles table for documentation
COMMENT ON TABLE forex_candles IS 'Primary table for all historical OHLC candle data. Single source of truth for market candles across all symbols and timeframes.';
