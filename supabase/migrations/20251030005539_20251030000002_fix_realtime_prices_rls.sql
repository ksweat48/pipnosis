/*
  # Fix RLS Policies for Realtime Prices

  1. Changes
    - Allow authenticated users to insert realtime prices (for client-side polling)
    - Keep read access for all authenticated users
    - Maintain service role permissions for cleanup operations

  2. Security
    - Users must be authenticated to insert price data
    - This enables the global polling coordinator to work from the client-side
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Service role can insert realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Authenticated users can insert realtime prices" ON realtime_prices;

-- Allow authenticated users to insert realtime prices
CREATE POLICY "Authenticated users can insert realtime prices"
  ON realtime_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Keep service role access for all operations (backward compatibility)
CREATE POLICY "Service role can manage realtime prices"
  ON realtime_prices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);