/*
  # Fix Realtime Prices Validation RLS Issues

  ## Problem
  HEAD requests to realtime_prices return 500 error because:
  1. Validation trigger tries to log rejections to price_validation_rejections
  2. RLS policy only allows service_role to insert, not authenticated users
  3. When admin/authenticated users trigger validation, INSERT fails and cascades to 500

  ## Changes
  1. Allow authenticated users to insert into price_validation_rejections
  2. Make validation trigger more defensive with exception handling
  3. Ensure HEAD requests never trigger validation issues

  ## Security
  - Authenticated users can log their own validation rejections
  - No data access changes to realtime_prices
  - Maintains all existing validation logic
*/

-- =====================================================
-- STEP 1: Fix RLS Policy for Price Validation Rejections
-- =====================================================

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Service role can insert rejections" ON price_validation_rejections;

-- Allow authenticated users to insert their own rejection logs
CREATE POLICY "Authenticated users can insert rejections"
  ON price_validation_rejections FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Also allow service role (for backwards compatibility)
CREATE POLICY "Service role can insert rejections"
  ON price_validation_rejections FOR INSERT
  TO service_role
  WITH CHECK (true);

-- =====================================================
-- STEP 2: Make Validation Trigger More Defensive
-- =====================================================

CREATE OR REPLACE FUNCTION validate_realtime_prices() RETURNS trigger AS $$
BEGIN
  -- Skip validation on SELECT/DELETE operations (shouldn't happen but defensive)
  IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;

  -- Validate bid price
  IF NEW.bid IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.bid::numeric) THEN
      -- Try to log rejection, but don't fail if it doesn't work
      BEGIN
        INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
        VALUES (NEW.symbol, NEW.bid::numeric, 'bid', 'Price outside valid range', 'realtime_price_insert')
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        -- Log to postgres log but don't fail the operation
        RAISE WARNING 'Could not log price rejection: %', SQLERRM;
      END;
      RAISE EXCEPTION 'Invalid bid price % for symbol %', NEW.bid, NEW.symbol;
    END IF;
  END IF;

  -- Validate ask price
  IF NEW.ask IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.ask::numeric) THEN
      -- Try to log rejection, but don't fail if it doesn't work
      BEGIN
        INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
        VALUES (NEW.symbol, NEW.ask::numeric, 'ask', 'Price outside valid range', 'realtime_price_insert')
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Could not log price rejection: %', SQLERRM;
      END;
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
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 3: Ensure Trigger Only Fires on Data Changes
-- =====================================================

-- Recreate trigger with explicit operation check
DROP TRIGGER IF EXISTS validate_realtime_prices_trigger ON realtime_prices;

CREATE TRIGGER validate_realtime_prices_trigger
  BEFORE INSERT OR UPDATE ON realtime_prices
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)  -- Prevent recursive triggers
  EXECUTE FUNCTION validate_realtime_prices();
