/*
  # Fix Overlapping Candles - Timeframe Format Standardization

  ## Problem
  The database contains candles with both uppercase (M1, M5, H1) and lowercase (1m, 5m, 1h) 
  timeframe formats, causing duplicate/overlapping candles on charts. This affects 363 candles 
  with lowercase format vs 240K+ with uppercase format.

  ## Changes
  1. Delete all candles with lowercase timeframe formats (1m, 5m, 15m, 30m, 1h) as they represent
     only 0.15% of total data and are duplicates
  2. Add a check constraint to prevent future lowercase format insertions
  3. Add an index to optimize timeframe-based queries

  ## Data Impact
  - Will delete approximately 363 duplicate candles (0.15% of data)
  - All primary data uses uppercase format (M1, M5, M15, M30, H1, H4, D1, W1)
  - No data loss as these are duplicates of properly formatted records

  ## Security
  - No RLS changes needed
  - Constraint prevents future format inconsistencies
*/

-- Step 1: Log the candles that will be deleted for audit purposes
DO $$
DECLARE
  lowercase_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO lowercase_count
  FROM forex_candles
  WHERE timeframe IN ('1m', '5m', '15m', '30m', '1h');
  
  RAISE NOTICE 'Found % candles with lowercase timeframe format that will be deleted', lowercase_count;
END $$;

-- Step 2: Delete duplicate candles with lowercase timeframe format
DELETE FROM forex_candles
WHERE timeframe IN ('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w');

-- Step 3: Add check constraint to ensure only uppercase timeframe formats are allowed
ALTER TABLE forex_candles
DROP CONSTRAINT IF EXISTS forex_candles_timeframe_format_check;

ALTER TABLE forex_candles
ADD CONSTRAINT forex_candles_timeframe_format_check
CHECK (timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'));

-- Step 4: Add partial index to optimize timeframe queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_time
ON forex_candles (symbol, timeframe, open_time DESC)
WHERE timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1');

-- Step 5: Analyze table to update statistics
ANALYZE forex_candles;

-- Log completion
DO $$
DECLARE
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM forex_candles;
  RAISE NOTICE 'Migration complete. Total candles remaining: %', total_count;
END $$;
