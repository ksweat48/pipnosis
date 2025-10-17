/*
  # Fix Market Analysis Table - Add Unique Constraint

  ## Summary
  Adds the missing unique constraint on (symbol, timeframe) to the market_analysis table.
  This constraint is required for upsert operations to work correctly.

  ## Changes
  1. Add unique constraint on (symbol, timeframe) columns
  2. Create supporting index for better query performance
  3. Handle any duplicate data that might exist

  ## Notes
  - The constraint ensures only one analysis record exists per symbol/timeframe combination
  - This enables ON CONFLICT clauses in upsert operations
  - Existing duplicate records will be cleaned up before adding the constraint
*/

-- First, remove any duplicate records, keeping only the most recent one
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY symbol, timeframe 
      ORDER BY analyzed_at DESC NULLS LAST, created_at DESC NULLS LAST
    ) as rn
  FROM market_analysis
)
DELETE FROM market_analysis
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Add the unique constraint on (symbol, timeframe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'market_analysis_symbol_timeframe_key'
  ) THEN
    ALTER TABLE market_analysis 
    ADD CONSTRAINT market_analysis_symbol_timeframe_key 
    UNIQUE (symbol, timeframe);
    
    RAISE NOTICE 'Added unique constraint on (symbol, timeframe)';
  ELSE
    RAISE NOTICE 'Unique constraint already exists';
  END IF;
END $$;

-- Create index to support the unique constraint if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_analysis_symbol_timeframe_unique 
ON market_analysis(symbol, timeframe);

-- Add a partial index for active trade signals
CREATE INDEX IF NOT EXISTS idx_market_analysis_valid_signals 
ON market_analysis(trade_signal_status, analyzed_at DESC) 
WHERE trade_signal_status = 'VALID';
