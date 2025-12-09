/*
  # Add Missing Columns to forex_candles

  1. Changes
    - Add `quality_score` column (numeric, optional) for data quality tracking
    - Add `data_source` column (text, optional) for source tracking
    - Both columns are nullable to support existing data
    - Default values provided for backward compatibility

  2. Notes
    - Existing data will have NULL values for these columns
    - Functions will populate these going forward
    - No data migration needed - backward compatible
*/

-- Add quality_score column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'quality_score'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN quality_score numeric;
  END IF;
END $$;

-- Add data_source column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'data_source'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN data_source text;
  END IF;
END $$;

-- Add index for data_source for query performance
CREATE INDEX IF NOT EXISTS idx_forex_candles_data_source 
ON forex_candles(data_source) 
WHERE data_source IS NOT NULL;