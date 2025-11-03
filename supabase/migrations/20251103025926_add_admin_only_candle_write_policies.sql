/*
  # Add Admin-Only Write Policies for Candle Data

  1. Changes to forex_candles table
    - Drop existing insert/update policies if they exist
    - Add admin-only INSERT policy
    - Add admin-only UPDATE policy
    - Keep existing SELECT policies for all authenticated users

  2. Changes to market_data table
    - Drop existing insert/update policies if they exist
    - Add admin-only INSERT policy
    - Add admin-only UPDATE policy
    - Keep existing SELECT policies for all authenticated users

  3. Changes to realtime_prices table
    - Add admin-only INSERT policy
    - Add admin-only UPDATE policy
    - Keep existing SELECT policies for all authenticated users

  4. Security
    - Only users with admin role can write candle data
    - All authenticated users can read candle data
    - Uses current_user_is_admin() function for role checks
*/

-- =====================================================
-- forex_candles table policies
-- =====================================================

-- Drop existing insert/update policies if they exist
DROP POLICY IF EXISTS "Users can insert candles" ON forex_candles;
DROP POLICY IF EXISTS "Users can update candles" ON forex_candles;
DROP POLICY IF EXISTS "Authenticated users can insert candles" ON forex_candles;
DROP POLICY IF EXISTS "Authenticated users can update candles" ON forex_candles;
DROP POLICY IF EXISTS "Service role can insert candles" ON forex_candles;
DROP POLICY IF EXISTS "Service role can update candles" ON forex_candles;

-- Create admin-only insert policy
CREATE POLICY "Admins can insert candles"
  ON forex_candles
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_is_admin());

-- Create admin-only update policy
CREATE POLICY "Admins can update candles"
  ON forex_candles
  FOR UPDATE
  TO authenticated
  USING (current_user_is_admin())
  WITH CHECK (current_user_is_admin());

-- =====================================================
-- market_data table policies
-- =====================================================

-- Drop existing insert/update policies if they exist
DROP POLICY IF EXISTS "Users can insert market data" ON market_data;
DROP POLICY IF EXISTS "Users can update market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can insert market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can update market data" ON market_data;
DROP POLICY IF EXISTS "Service role can insert market data" ON market_data;
DROP POLICY IF EXISTS "Service role can update market data" ON market_data;

-- Create admin-only insert policy
CREATE POLICY "Admins can insert market data"
  ON market_data
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_is_admin());

-- Create admin-only update policy
CREATE POLICY "Admins can update market data"
  ON market_data
  FOR UPDATE
  TO authenticated
  USING (current_user_is_admin())
  WITH CHECK (current_user_is_admin());

-- =====================================================
-- realtime_prices table policies
-- =====================================================

-- Drop existing insert/update policies if they exist
DROP POLICY IF EXISTS "Users can insert realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Users can update realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Authenticated users can insert realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Authenticated users can update realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Service role can insert realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Service role can update realtime prices" ON realtime_prices;

-- Create admin-only insert policy
CREATE POLICY "Admins can insert realtime prices"
  ON realtime_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_is_admin());

-- Create admin-only update policy
CREATE POLICY "Admins can update realtime prices"
  ON realtime_prices
  FOR UPDATE
  TO authenticated
  USING (current_user_is_admin())
  WITH CHECK (current_user_is_admin());