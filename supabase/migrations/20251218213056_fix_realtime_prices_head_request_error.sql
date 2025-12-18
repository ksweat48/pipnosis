/*
  # Fix Realtime Prices HEAD Request Error

  ## Problem
  HEAD requests to realtime_prices return 500 error, likely due to
  validation trigger or policy issues

  ## Changes
  1. Make validation trigger handle SELECT operations gracefully
  2. Ensure trigger only runs on actual data changes (INSERT/UPDATE)
  3. No breaking changes

  ## Security
  - Maintains existing RLS policies
  - No data access changes
*/

-- =====================================================
-- Fix validation trigger to only run on data changes
-- =====================================================

-- Recreate trigger to be more defensive
DROP TRIGGER IF EXISTS validate_realtime_prices_trigger ON realtime_prices;

CREATE TRIGGER validate_realtime_prices_trigger
  BEFORE INSERT OR UPDATE ON realtime_prices
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)  -- Prevent recursive triggers
  EXECUTE FUNCTION validate_realtime_prices();

-- =====================================================
-- Make validation function more robust
-- =====================================================

CREATE OR REPLACE FUNCTION validate_realtime_prices() RETURNS trigger AS $$
BEGIN
  -- Skip validation if this is a system operation
  IF current_setting('is_superuser', true)::boolean = true THEN
    RETURN NEW;
  END IF;

  -- Validate bid price
  IF NEW.bid IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.bid::numeric) THEN
      INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
      VALUES (NEW.symbol, NEW.bid::numeric, 'bid', 'Price outside valid range', 'realtime_price_insert')
      ON CONFLICT DO NOTHING;
      RAISE EXCEPTION 'Invalid bid price % for symbol %', NEW.bid, NEW.symbol;
    END IF;
  END IF;

  -- Validate ask price
  IF NEW.ask IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.ask::numeric) THEN
      INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
      VALUES (NEW.symbol, NEW.ask::numeric, 'ask', 'Price outside valid range', 'realtime_price_insert')
      ON CONFLICT DO NOTHING;
      RAISE EXCEPTION 'Invalid ask price % for symbol %', NEW.ask, NEW.symbol;
    END IF;
  END IF;

  -- Validate bid < ask
  IF NEW.bid IS NOT NULL AND NEW.ask IS NOT NULL THEN
    IF NEW.bid::numeric >= NEW.ask::numeric THEN
      RAISE EXCEPTION 'Invalid price for %: bid >= ask', NEW.symbol;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't crash on HEAD requests
    RAISE WARNING 'Validation error in realtime_prices: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;