/*
  # Rollback Realtime Prices SSOT Violation

  ## Summary
  Removes generated columns (price, updated_at) that created a dual source of truth.
  These columns were aliases for mid and created_at, violating SSOT principles.

  ## Changes
  1. Drop generated columns
    - Remove `price` (was: GENERATED ALWAYS AS (mid))
    - Remove `updated_at` (was: GENERATED ALWAYS AS (created_at))

  2. Enforce SSOT
    - `mid` is the canonical "price" column
    - `created_at` is the canonical "timestamp" column
    - All consumers must query canonical columns directly

  ## Impact
  - Only 1 service was using the wrong columns (price-freshness-gate.ts)
  - 116+ other services already use canonical columns correctly
  - No data loss (only removing computed aliases)
  - Storage savings: ~32MB for 200K rows

  ## SSOT Principle
  "If the same problem can be fixed in more than one place, the architecture is broken."

  Before: Could query mid OR price, created_at OR updated_at (ambiguous)
  After: Must query mid and created_at (single source of truth)

  ## References
  - Original table: 20251224101143_create_realtime_prices_table.sql
  - Consumer fix: src/governance/price-freshness-gate.ts
  - Authority: RESPONSIBILITY_REGISTRY.md
*/

-- Drop generated columns that violate SSOT
DO $$
BEGIN
  -- Drop price column if it exists and is generated
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'realtime_prices'
    AND column_name = 'price'
    AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE realtime_prices DROP COLUMN price;
    RAISE NOTICE 'Dropped generated column: price (use mid instead)';
  END IF;

  -- Drop updated_at column if it exists and is generated
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'realtime_prices'
    AND column_name = 'updated_at'
    AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE realtime_prices DROP COLUMN updated_at;
    RAISE NOTICE 'Dropped generated column: updated_at (use created_at instead)';
  END IF;
END $$;

-- Add table comment documenting SSOT
COMMENT ON TABLE realtime_prices IS
  'SSOT for realtime market prices. Canonical columns: mid (price), created_at (timestamp).';

-- Add column comments for clarity
COMMENT ON COLUMN realtime_prices.mid IS
  'SSOT price column. Calculated as (bid + ask) / 2. Use this, not a "price" alias.';

COMMENT ON COLUMN realtime_prices.created_at IS
  'SSOT timestamp column. Record creation time. Use this, not an "updated_at" alias.';

-- Verify canonical columns exist
DO $$
DECLARE
  has_mid boolean;
  has_created_at boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'realtime_prices' AND column_name = 'mid'
  ) INTO has_mid;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'realtime_prices' AND column_name = 'created_at'
  ) INTO has_created_at;

  IF NOT has_mid THEN
    RAISE EXCEPTION 'SSOT violation: mid column missing from realtime_prices';
  END IF;

  IF NOT has_created_at THEN
    RAISE EXCEPTION 'SSOT violation: created_at column missing from realtime_prices';
  END IF;

  RAISE NOTICE '✅ SSOT verified: canonical columns (mid, created_at) present';
END $$;
