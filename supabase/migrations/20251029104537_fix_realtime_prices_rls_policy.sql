/*
  # Fix realtime_prices RLS policies

  ## Changes
  - Add INSERT policy for authenticated users to write realtime prices
  - Allow authenticated users (especially admins) to write price data from the frontend
  
  ## Security
  - Maintains read access for all authenticated users
  - Adds write access for authenticated users (required for live price streaming)
  - Service role retains full access
*/

-- Drop the restrictive service_role-only insert policy
DROP POLICY IF EXISTS "Service role can insert realtime prices" ON realtime_prices;

-- Create a new policy that allows authenticated users to insert realtime prices
CREATE POLICY "Authenticated users can insert realtime prices"
  ON realtime_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Also allow authenticated users to delete old prices (for cleanup)
DROP POLICY IF EXISTS "Service role can delete old realtime prices" ON realtime_prices;

CREATE POLICY "Authenticated users can delete old realtime prices"
  ON realtime_prices
  FOR DELETE
  TO authenticated
  USING (true);
