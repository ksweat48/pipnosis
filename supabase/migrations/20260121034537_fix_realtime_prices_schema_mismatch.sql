/*
  # Fix realtime_prices Schema Mismatch

  1. Problem
    - Frontend queries for `price` and `updated_at` columns
    - Table only has `mid` and `created_at` columns
    - Causes 400 Bad Request errors blocking all trades

  2. Solution
    - Add `price` as a generated column (equals `mid` for convenience)
    - Add `updated_at` as a generated column (equals `created_at`)
    - These are computed columns that automatically stay in sync

  3. Impact
    - Fixes Price Freshness Gate failures
    - Enables trade execution to proceed
    - No data migration needed (computed on-the-fly)
*/

-- Add price column as generated column (always equals mid)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'realtime_prices' AND column_name = 'price'
  ) THEN
    ALTER TABLE realtime_prices 
    ADD COLUMN price numeric GENERATED ALWAYS AS (mid) STORED;
  END IF;
END $$;

-- Add updated_at column as generated column (equals created_at for compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'realtime_prices' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE realtime_prices 
    ADD COLUMN updated_at timestamptz GENERATED ALWAYS AS (created_at) STORED;
  END IF;
END $$;

-- Add helpful comments
COMMENT ON COLUMN realtime_prices.price IS 'Convenience column: equals mid price for frontend compatibility';
COMMENT ON COLUMN realtime_prices.updated_at IS 'Convenience column: equals created_at for frontend compatibility';
