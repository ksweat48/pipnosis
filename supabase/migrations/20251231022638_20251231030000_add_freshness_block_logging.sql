/*
  # Add Freshness Block Category Logging

  ## Changes
  1. Add `block_category` column to cache_stats_log for distinct block type tracking
  2. Add `block_metadata` column for structured metadata (symbol, drift, ages, etc.)
  3. Update constraint to allow 'block' event type
  4. Add index for efficient analytics queries

  ## Purpose
  Enable granular analytics on why trades are blocked:
  - BLOCK_STALE_OMEGA_INTELLIGENCE
  - BLOCK_STALE_ALPHA_INTELLIGENCE
  - BLOCK_PRICE_DRIFT
  - BLOCK_STALE_PRICE_FEED
  - BLOCK_NO_PRICE_DATA
  - BLOCK_PERSISTENT_STALENESS

  This allows data-driven optimization of TTLs and thresholds.
*/

-- Add block_category column for distinct block logging
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_stats_log'
    AND column_name = 'block_category'
  ) THEN
    ALTER TABLE cache_stats_log
    ADD COLUMN block_category text;
  END IF;
END $$;

-- Add block_metadata column for structured data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cache_stats_log'
    AND column_name = 'block_metadata'
  ) THEN
    ALTER TABLE cache_stats_log
    ADD COLUMN block_metadata jsonb;
  END IF;
END $$;

-- Update event_type constraint to include 'block'
DO $$
BEGIN
  -- Drop existing constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'valid_event_type'
  ) THEN
    ALTER TABLE cache_stats_log DROP CONSTRAINT valid_event_type;
  END IF;

  -- Add new constraint with 'block' included
  ALTER TABLE cache_stats_log
  ADD CONSTRAINT valid_event_type
  CHECK (event_type IN ('lookup', 'write', 'expire', 'warm', 'block'));
END $$;

-- Add block_category constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'valid_block_category'
  ) THEN
    ALTER TABLE cache_stats_log
    ADD CONSTRAINT valid_block_category
    CHECK (
      block_category IS NULL OR
      block_category IN (
        'BLOCK_STALE_OMEGA_INTELLIGENCE',
        'BLOCK_STALE_ALPHA_INTELLIGENCE',
        'BLOCK_PRICE_DRIFT',
        'BLOCK_STALE_PRICE_FEED',
        'BLOCK_NO_PRICE_DATA',
        'BLOCK_PERSISTENT_STALENESS'
      )
    );
  END IF;
END $$;

-- Create index for block analytics
CREATE INDEX IF NOT EXISTS idx_cache_stats_block_category
ON cache_stats_log(block_category, created_at)
WHERE event_type = 'block';

-- Create index for block metadata queries
CREATE INDEX IF NOT EXISTS idx_cache_stats_block_metadata
ON cache_stats_log USING gin(block_metadata)
WHERE event_type = 'block';

-- Comment for documentation
COMMENT ON COLUMN cache_stats_log.block_category IS 'Category of freshness block for analytics (e.g., BLOCK_STALE_OMEGA_INTELLIGENCE, BLOCK_PRICE_DRIFT)';
COMMENT ON COLUMN cache_stats_log.block_metadata IS 'Structured metadata about the block: symbol, timeframe, ages, drift values, etc.';
