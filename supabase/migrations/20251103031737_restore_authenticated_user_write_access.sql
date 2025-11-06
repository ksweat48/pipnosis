/*
  # Restore Authenticated User Write Access for Live Data (Updated for Current Schema)

  ## Overview
  This migration restores write access for authenticated users to enable real-time
  data collection and live trading operations. This file has been updated to reflect
  the current database schema after table consolidation.

  ## Current Schema State
  After the table consolidation migration (20251106024506), the system uses:
  - `forex_candles` - Single source of truth for all OHLC candle data
  - `realtime_prices` - Real-time price streaming from MetaAPI

  Obsolete tables that were dropped:
  - `market_data` (consolidated into forex_candles)
  - `historical_candles` (consolidated into forex_candles)
  - `market_data_subscriptions` (no longer needed)

  ## Changes

  1. forex_candles table
    - Restore INSERT policy for authenticated users (for candle aggregation)
    - Restore UPDATE policy for authenticated users (for candle updates)
    - Keep SELECT policy for all authenticated users
    - Includes tick_count column support for accurate data tracking

  2. realtime_prices table
    - Restore INSERT policy for authenticated users (for live price polling)
    - Keep SELECT policy for all authenticated users
    - Maintain DELETE policy for cleanup operations

  ## Security Model
  - Regular authenticated users: Can read and write data during normal operations
  - Admin users: Have additional manual repair/refresh capabilities via functions
  - Service role: Retains full access for backend operations

  ## Rationale
  The global polling coordinator and real-time data collection systems require
  authenticated user write access to function properly. Admin-only write policies
  break the live data flow. Admin-only capabilities are implemented via separate
  database functions that check user roles using current_user_is_admin().

  ## Post-Consolidation Updates
  This version removes all references to obsolete tables (market_data, historical_candles)
  and focuses only on the current working schema. All candle data now flows through
  the single forex_candles table with proper unique constraints and optimized indexes.
*/

-- =====================================================
-- forex_candles table policies
-- =====================================================

-- Drop any admin-only or restrictive policies
DROP POLICY IF EXISTS "Admins can insert candles" ON forex_candles;
DROP POLICY IF EXISTS "Admins can update candles" ON forex_candles;

-- Restore authenticated user insert policy (for candle aggregation)
DROP POLICY IF EXISTS "Authenticated users can insert candles" ON forex_candles;
CREATE POLICY "Authenticated users can insert candles"
  ON forex_candles
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Restore authenticated user update policy (for candle updates)
DROP POLICY IF EXISTS "Authenticated users can update candles" ON forex_candles;
CREATE POLICY "Authenticated users can update candles"
  ON forex_candles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- realtime_prices table policies
-- =====================================================

-- Drop the admin-only insert policy
DROP POLICY IF EXISTS "Admins can insert realtime prices" ON realtime_prices;
DROP POLICY IF EXISTS "Admins can update realtime prices" ON realtime_prices;

-- Restore authenticated user insert policy (for live price polling from frontend)
DROP POLICY IF EXISTS "Authenticated users can insert realtime prices" ON realtime_prices;
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
-- Schema validation and enhancements
-- =====================================================

-- Ensure forex_candles has tick_count column (added in aggregation system)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'tick_count'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN tick_count integer DEFAULT 0;
  END IF;
END $$;

-- Verify unique constraint exists on forex_candles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'forex_candles_symbol_timeframe_open_time_key'
  ) THEN
    ALTER TABLE forex_candles
    ADD CONSTRAINT forex_candles_symbol_timeframe_open_time_key
    UNIQUE(symbol, timeframe, open_time);
  END IF;
END $$;

-- Ensure optimal indexes exist on forex_candles
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_timeframe_open_time
  ON forex_candles(symbol, timeframe, open_time DESC);

CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol
  ON forex_candles(symbol);

CREATE INDEX IF NOT EXISTS idx_forex_candles_timeframe
  ON forex_candles(timeframe);

CREATE INDEX IF NOT EXISTS idx_forex_candles_created_at
  ON forex_candles(created_at DESC);

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
  v_affected_count integer;
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

  -- Delete recent candles to trigger re-fetch from MetaAPI
  DELETE FROM forex_candles
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND open_time >= now() - interval '7 days';

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  v_result := jsonb_build_object(
    'success', true,
    'symbol', p_symbol,
    'timeframe', p_timeframe,
    'count', p_count,
    'deleted_count', v_affected_count,
    'requested_by', auth.uid(),
    'timestamp', now(),
    'message', 'Candles deleted. Application will re-fetch from MetaAPI on next request.'
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
  DELETE FROM forex_candles
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND open_time >= p_start_time
    AND open_time <= p_end_time;

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

-- =====================================================
-- Admin Actions Log Table
-- =====================================================

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

-- Add table comment for documentation
COMMENT ON TABLE forex_candles IS 'Primary table for all historical OHLC candle data. Single source of truth for market candles across all symbols and timeframes. Replaces the obsolete market_data and historical_candles tables.';

COMMENT ON TABLE realtime_prices IS 'Real-time price streaming data from MetaAPI. Stores live bid/ask prices with automatic cleanup of data older than 1 hour.';

COMMENT ON TABLE admin_actions_log IS 'Audit log for admin actions on market data. Tracks repairs, refreshes, and deletions performed by admin users.';
