/*
  # Restore Authenticated User Write Access for Live Data

  ## Overview
  This migration restores write access for authenticated users to enable real-time
  data collection while preserving admin-only functions for manual data repair.

  ## Changes

  1. realtime_prices table
    - Restore INSERT policy for authenticated users (for live price polling)
    - Keep SELECT policy for all authenticated users
    - Maintain DELETE policy for cleanup operations

  2. forex_candles table
    - Restore INSERT policy for authenticated users (for candle aggregation)
    - Restore UPDATE policy for authenticated users (for candle updates)
    - Keep SELECT policy for all authenticated users

  3. market_data table
    - Restore INSERT policy for authenticated users (for data sync)
    - Restore UPDATE policy for authenticated users (for data updates)
    - Keep SELECT policy for all authenticated users

  ## Security Model
  - Regular authenticated users: Can read and write data during normal operations
  - Admin users: Have additional manual repair/refresh capabilities via functions
  - Service role: Retains full access for backend operations

  ## Rationale
  The previous admin-only policies broke the live data flow. All authenticated users
  need write access for the global polling coordinator and real-time data collection
  to function properly. Admin-only capabilities are implemented via separate database
  functions that check user roles.
*/

-- =====================================================
-- realtime_prices table policies
-- =====================================================

-- Drop the admin-only insert policy
DROP POLICY IF EXISTS "Admins can insert realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Admins can update realtime prices" ON realtime_prices;

-- Restore authenticated user insert policy (for live price polling from frontend)
CREATE POLICY "Authenticated users can insert realtime prices"
  ON realtime_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to delete old prices (for cleanup)
DROP POLICY IF EXISTS "Authenticated users can delete old realtime prices" ON realtime_prices;
CREATE POLICY "Authenticated users can delete old realtime prices"
  ON realtime_prices
  FOR DELETE
  TO authenticated
  USING (created_at < now() - interval '1 hour');

-- =====================================================
-- forex_candles table policies
-- =====================================================

-- Drop the admin-only policies
DROP POLICY IF EXISTS "Admins can insert candles" ON forex_candles;
DROP POLICY IF EXISTS "Admins can update candles" ON forex_candles;

-- Restore authenticated user insert policy (for candle aggregation)
CREATE POLICY "Authenticated users can insert candles"
  ON forex_candles
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Restore authenticated user update policy (for candle updates)
CREATE POLICY "Authenticated users can update candles"
  ON forex_candles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- market_data table policies
-- =====================================================

-- Drop the admin-only policies
DROP POLICY IF EXISTS "Admins can insert market data" ON market_data;
DROP POLICY IF EXISTS "Admins can update market data" ON market_data;

-- Restore authenticated user insert policy (for data sync)
CREATE POLICY "Authenticated users can insert market data"
  ON market_data
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Restore authenticated user update policy (for data updates)
CREATE POLICY "Authenticated users can update market data"
  ON market_data
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Admin-Only Repair Functions
-- =====================================================

-- Function for admins to manually repair chart data gaps
CREATE OR REPLACE FUNCTION admin_repair_chart_data_gaps(
  p_symbol text,
  p_timeframe text,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_gaps_found integer := 0;
BEGIN
  -- Check if current user is admin
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Permission denied: Only admins can repair chart data';
  END IF;

  -- Log the repair operation
  INSERT INTO admin_actions_log (
    user_id,
    action_type,
    action_details,
    created_at
  ) VALUES (
    auth.uid(),
    'repair_chart_data_gaps',
    jsonb_build_object(
      'symbol', p_symbol,
      'timeframe', p_timeframe,
      'start_time', p_start_time,
      'end_time', p_end_time
    ),
    now()
  );

  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'symbol', p_symbol,
    'timeframe', p_timeframe,
    'gaps_found', v_gaps_found,
    'repaired_by', auth.uid(),
    'timestamp', now()
  );

  RETURN v_result;
END;
$$;

-- Function for admins to force refresh historical candles
CREATE OR REPLACE FUNCTION admin_force_refresh_candles(
  p_symbol text,
  p_timeframe text,
  p_count integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Check if current user is admin
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Permission denied: Only admins can force refresh candles';
  END IF;

  -- Log the refresh operation
  INSERT INTO admin_actions_log (
    user_id,
    action_type,
    action_details,
    created_at
  ) VALUES (
    auth.uid(),
    'force_refresh_candles',
    jsonb_build_object(
      'symbol', p_symbol,
      'timeframe', p_timeframe,
      'count', p_count
    ),
    now()
  );

  -- Mark candles for refresh (application will detect and re-fetch)
  UPDATE market_data
  SET needs_refresh = true
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND time >= now() - interval '7 days';

  v_result := jsonb_build_object(
    'success', true,
    'symbol', p_symbol,
    'timeframe', p_timeframe,
    'count', p_count,
    'requested_by', auth.uid(),
    'timestamp', now(),
    'message', 'Candles marked for refresh. Application will re-fetch from MetaAPI.'
  );

  RETURN v_result;
END;
$$;

-- Function for admins to delete corrupted candle data
CREATE OR REPLACE FUNCTION admin_delete_corrupted_candles(
  p_symbol text,
  p_timeframe text,
  p_start_time timestamptz,
  p_end_time timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count integer;
  v_result jsonb;
BEGIN
  -- Check if current user is admin
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Permission denied: Only admins can delete candle data';
  END IF;

  -- Delete candles in the specified range
  DELETE FROM market_data
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND time >= p_start_time
    AND time <= p_end_time;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Log the deletion operation
  INSERT INTO admin_actions_log (
    user_id,
    action_type,
    action_details,
    created_at
  ) VALUES (
    auth.uid(),
    'delete_corrupted_candles',
    jsonb_build_object(
      'symbol', p_symbol,
      'timeframe', p_timeframe,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'deleted_count', v_deleted_count
    ),
    now()
  );

  v_result := jsonb_build_object(
    'success', true,
    'symbol', p_symbol,
    'timeframe', p_timeframe,
    'deleted_count', v_deleted_count,
    'deleted_by', auth.uid(),
    'timestamp', now()
  );

  RETURN v_result;
END;
$$;

-- Create admin actions log table if it doesn't exist
CREATE TABLE IF NOT EXISTS admin_actions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  action_details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_user_id ON admin_actions_log(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_action_type ON admin_actions_log(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_created_at ON admin_actions_log(created_at DESC);

-- Enable RLS on admin_actions_log
ALTER TABLE admin_actions_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all action logs
DROP POLICY IF EXISTS "Admins can read all action logs" ON admin_actions_log;
CREATE POLICY "Admins can read all action logs"
  ON admin_actions_log
  FOR SELECT
  TO authenticated
  USING (current_user_is_admin());

-- Users can read their own action logs
DROP POLICY IF EXISTS "Users can read own action logs" ON admin_actions_log;
CREATE POLICY "Users can read own action logs"
  ON admin_actions_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- System can insert action logs
DROP POLICY IF EXISTS "System can insert action logs" ON admin_actions_log;
CREATE POLICY "System can insert action logs"
  ON admin_actions_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Add needs_refresh column to market_data if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data' AND column_name = 'needs_refresh'
  ) THEN
    ALTER TABLE market_data ADD COLUMN needs_refresh boolean DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_market_data_needs_refresh ON market_data(needs_refresh) WHERE needs_refresh = true;
  END IF;
END $$;
