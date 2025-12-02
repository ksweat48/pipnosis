/*
  # Fix realtime_prices RLS Policies

  ## Problem
  Client-side code (emergency poller) was trying to INSERT into realtime_prices table.
  This caused 404 errors in console because authenticated users should NOT write prices.

  ## Solution
  - Drop the "Authenticated users can insert realtime prices" policy
  - Only Netlify functions (service_role) should insert prices
  - Clients should only read prices

  ## Changes
  1. Drop INSERT policy for authenticated users
  2. Keep SELECT policy for reading
  3. Keep DELETE policy for cleanup (old prices)
  4. Service role keeps full access
*/

-- Drop the policy that allows client-side inserts
DROP POLICY IF EXISTS "Authenticated users can insert realtime prices" ON realtime_prices;

-- Ensure service role has full access (should already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'realtime_prices' 
    AND policyname = 'Service role full access to realtime prices'
  ) THEN
    CREATE POLICY "Service role full access to realtime prices"
      ON realtime_prices
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Add comment explaining the architecture
COMMENT ON TABLE realtime_prices IS 'Live forex prices. ONLY written by Netlify continuous-price-collector function. Clients read only.';
