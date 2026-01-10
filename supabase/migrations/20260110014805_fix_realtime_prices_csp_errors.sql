/*
  # Fix Realtime Prices Errors - Emergency Production Fix
  
  ## Problem
  Console flooded with 400 errors from realtime_prices table queries.
  Multiple health checks running every 2 seconds all failing.
  
  ## Solution
  Re-apply the clean slate RLS policy fix to ensure production has correct policies.
  This migration is idempotent and safe to re-run.
  
  ## Changes
  1. Clean all existing policies
  2. Create simple, clear policies (anyone can SELECT, service role can write)
  3. Ensure validation trigger is defensive
  4. Grant explicit SELECT permissions
*/

-- =====================================================
-- STEP 1: Clean Slate - Remove All Existing Policies
-- =====================================================

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE tablename = 'realtime_prices'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON realtime_prices', pol.policyname);
    END LOOP;
END $$;

-- =====================================================
-- STEP 2: Create Simple, Clear RLS Policies
-- =====================================================

-- Allow anyone (anon + authenticated) to read prices
-- This is safe because prices are public market data
CREATE POLICY "Anyone can read realtime prices"
  ON realtime_prices
  FOR SELECT
  USING (true);

-- Only service role can insert prices (backend-only)
CREATE POLICY "Service role can insert prices"
  ON realtime_prices
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Only service role can update prices
CREATE POLICY "Service role can update prices"
  ON realtime_prices
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Only service role can delete old prices
CREATE POLICY "Service role can delete prices"
  ON realtime_prices
  FOR DELETE
  TO service_role
  USING (true);

-- =====================================================
-- STEP 3: Ensure Validation Trigger is Defensive
-- =====================================================

-- Make sure validation function handles edge cases
CREATE OR REPLACE FUNCTION validate_realtime_prices() RETURNS trigger AS $$
BEGIN
  -- Skip if not INSERT/UPDATE (defensive)
  IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;

  -- Skip if NEW is null (defensive)
  IF NEW IS NULL THEN
    RETURN NEW;
  END IF;

  -- Validate bid price
  IF NEW.bid IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.bid::numeric) THEN
      -- Log rejection but use exception handler to prevent cascading errors
      BEGIN
        INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
        VALUES (NEW.symbol, NEW.bid::numeric, 'bid', 'Price outside valid range', 'realtime_price_insert')
        ON CONFLICT DO NOTHING;
      EXCEPTION
        WHEN OTHERS THEN
          -- Log to postgres log but don't fail
          RAISE WARNING 'Could not log price rejection for %: %', NEW.symbol, SQLERRM;
      END;
      -- Still reject the invalid price
      RAISE EXCEPTION 'Invalid bid price % for symbol %', NEW.bid, NEW.symbol;
    END IF;
  END IF;

  -- Validate ask price
  IF NEW.ask IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.ask::numeric) THEN
      BEGIN
        INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
        VALUES (NEW.symbol, NEW.ask::numeric, 'ask', 'Price outside valid range', 'realtime_price_insert')
        ON CONFLICT DO NOTHING;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'Could not log price rejection for %: %', NEW.symbol, SQLERRM;
      END;
      RAISE EXCEPTION 'Invalid ask price % for symbol %', NEW.ask, NEW.symbol;
    END IF;
  END IF;

  -- Validate bid < ask
  IF NEW.bid IS NOT NULL AND NEW.ask IS NOT NULL THEN
    IF NEW.bid::numeric >= NEW.ask::numeric THEN
      RAISE EXCEPTION 'Invalid price for %: bid % >= ask %', NEW.symbol, NEW.bid, NEW.ask;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists with correct configuration
DROP TRIGGER IF EXISTS validate_realtime_prices_trigger ON realtime_prices;

CREATE TRIGGER validate_realtime_prices_trigger
  BEFORE INSERT OR UPDATE ON realtime_prices
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)  -- Prevent recursive triggers
  EXECUTE FUNCTION validate_realtime_prices();

-- =====================================================
-- STEP 4: Verify RLS is Enabled
-- =====================================================

-- Ensure RLS is enabled (should already be, but defensive)
ALTER TABLE realtime_prices ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 5: Grant SELECT to Anon Role Explicitly
-- =====================================================

-- Ensure anon role can execute SELECT queries
GRANT SELECT ON realtime_prices TO anon;
GRANT SELECT ON realtime_prices TO authenticated;

-- =====================================================
-- Verification
-- =====================================================

DO $$
BEGIN
  -- Verify policies exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'realtime_prices'
    AND policyname = 'Anyone can read realtime prices'
  ) THEN
    RAISE EXCEPTION 'SELECT policy not created!';
  END IF;

  -- Verify trigger exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'validate_realtime_prices_trigger'
    AND tgrelid = 'public.realtime_prices'::regclass
  ) THEN
    RAISE EXCEPTION 'Validation trigger not created!';
  END IF;

  RAISE NOTICE '✅ Realtime prices RLS and validation fixed successfully';
  RAISE NOTICE '✅ HEAD requests should now work correctly';
  RAISE NOTICE '✅ Console 400 errors should be resolved';
END $$;