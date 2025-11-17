/*
  # Restore Service Role Access to Forex Candles and Market Data

  ## Problem
  Migration 20251103025926 dropped service role policies for forex_candles and market_data.
  Migration 20251103031737 restored authenticated user access but did NOT restore service role access.
  This caused Netlify functions using SUPABASE_SERVICE_ROLE_KEY to fail with 400 Bad Request
  when attempting to insert candle data.

  ## Solution
  Re-create the service role policies that allow Netlify functions to bypass RLS and insert
  candle data into the database.

  ## Changes

  1. forex_candles table
    - Add service role policy for ALL operations (INSERT, UPDATE, DELETE, SELECT)
    - Service role bypasses all RLS restrictions
    - Required for Netlify functions that fetch and store historical candle data

  2. market_data table (if exists)
    - Add service role policy for ALL operations
    - Service role bypasses all RLS restrictions
    - Required for Netlify functions that save candle data to market_data

  3. realtime_prices table
    - Add service role policy for ALL operations
    - Required for price polling functions

  ## Security
  - Service role key is stored securely in Netlify environment variables
  - Service role is only used by trusted backend functions
  - Regular users continue to use authenticated user policies
  - Admin users continue to use admin policies for manual operations
*/

-- =====================================================
-- Restore Service Role Policy for forex_candles
-- =====================================================

-- Drop if exists to ensure clean state
DROP POLICY IF EXISTS "Service role full access to candles" ON forex_candles;

-- Create service role policy for ALL operations
CREATE POLICY "Service role full access to candles"
  ON forex_candles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Restore Service Role Policy for market_data (if table exists)
-- =====================================================

-- Only create policy if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'market_data'
  ) THEN
    -- Drop if exists to ensure clean state
    EXECUTE 'DROP POLICY IF EXISTS "Service role full access to market data" ON market_data';

    -- Create service role policy for ALL operations
    EXECUTE 'CREATE POLICY "Service role full access to market data"
      ON market_data
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true)';

    RAISE NOTICE 'Created service role policy for market_data table';
  ELSE
    RAISE NOTICE 'market_data table does not exist, skipping policy creation';
  END IF;
END $$;

-- =====================================================
-- Restore Service Role Policy for realtime_prices
-- =====================================================

-- Drop if exists to ensure clean state
DROP POLICY IF EXISTS "Service role full access to live prices" ON realtime_prices;
DROP POLICY IF EXISTS "Service role full access to realtime prices" ON realtime_prices;

-- Create service role policy for ALL operations
CREATE POLICY "Service role full access to realtime prices"
  ON realtime_prices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Verification Query
-- =====================================================

-- This query can be run after migration to verify policies exist
-- SELECT
--   schemaname,
--   tablename,
--   policyname,
--   roles,
--   cmd
-- FROM pg_policies
-- WHERE tablename IN ('forex_candles', 'market_data', 'realtime_prices')
--   AND 'service_role' = ANY(roles)
-- ORDER BY tablename, policyname;