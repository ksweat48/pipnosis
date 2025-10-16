/*
  # Cleanup Market Analysis Schema

  1. Schema Consolidation
    - Ensures market_analysis table uses the public schema (no user_id)
    - Removes any conflicting columns or constraints
    - Preserves existing valid data

  2. Changes
    - Drop user_id column if it exists
    - Ensure UNIQUE constraint on (symbol, timeframe)
    - Update RLS policies for public read, authenticated write
    - Add missing indexes for performance

  3. Notes
    - This migration is idempotent and safe to run multiple times
    - Handles both fresh installs and existing databases
*/

-- Drop user_id column if it exists (from conflicting migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_analysis' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE market_analysis DROP COLUMN user_id;
    RAISE NOTICE 'Dropped user_id column from market_analysis';
  END IF;
END $$;

-- Drop any user-specific policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can read own market analysis" ON market_analysis;
  DROP POLICY IF EXISTS "Users can insert own market analysis" ON market_analysis;
  DROP POLICY IF EXISTS "Users can update own market analysis" ON market_analysis;
  DROP POLICY IF EXISTS "Users can delete own market analysis" ON market_analysis;
  RAISE NOTICE 'Dropped user-specific policies';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Some policies did not exist, continuing...';
END $$;

-- Ensure public read policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'market_analysis'
    AND policyname = 'Anyone can read market analysis'
  ) THEN
    CREATE POLICY "Anyone can read market analysis"
      ON market_analysis FOR SELECT
      TO anon, authenticated
      USING (true);
    RAISE NOTICE 'Created public read policy';
  END IF;
END $$;

-- Ensure authenticated write policies exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'market_analysis'
    AND policyname = 'Authenticated users can insert market analysis'
  ) THEN
    CREATE POLICY "Authenticated users can insert market analysis"
      ON market_analysis FOR INSERT
      TO authenticated
      WITH CHECK (true);
    RAISE NOTICE 'Created authenticated insert policy';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'market_analysis'
    AND policyname = 'Authenticated users can update market analysis'
  ) THEN
    CREATE POLICY "Authenticated users can update market analysis"
      ON market_analysis FOR UPDATE
      TO authenticated
      USING (true)
      WITH CHECK (true);
    RAISE NOTICE 'Created authenticated update policy';
  END IF;
END $$;

-- Ensure unique constraint on (symbol, timeframe) exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_analysis_symbol_timeframe_key'
  ) THEN
    ALTER TABLE market_analysis
      ADD CONSTRAINT market_analysis_symbol_timeframe_key
      UNIQUE (symbol, timeframe);
    RAISE NOTICE 'Added unique constraint on (symbol, timeframe)';
  END IF;
END $$;

-- Ensure indexes exist for optimal performance
CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol
  ON market_analysis(symbol);

CREATE INDEX IF NOT EXISTS idx_market_analysis_timeframe
  ON market_analysis(timeframe);

CREATE INDEX IF NOT EXISTS idx_market_analysis_symbol_timeframe
  ON market_analysis(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_market_analysis_analyzed_at
  ON market_analysis(analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_analysis_trade_signal_status
  ON market_analysis(trade_signal_status) WHERE trade_signal_status = 'VALID';

-- Verify table structure
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'market_analysis' AND column_name = 'user_id';

  IF col_count > 0 THEN
    RAISE EXCEPTION 'user_id column still exists after cleanup!';
  ELSE
    RAISE NOTICE '✅ Market analysis schema cleanup complete';
  END IF;
END $$;
