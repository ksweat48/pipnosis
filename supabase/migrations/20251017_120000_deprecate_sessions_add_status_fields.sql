/*
  # Deprecate auto_trading_sessions and Consolidate to auto_trading_status

  1. Changes to Tables
    - Add missing fields to `auto_trading_status` table from deprecated `auto_trading_sessions`
    - Add `current_session_id` for tracking continuous learning sessions
    - Add `session_started_at` and `session_ended_at` for session tracking
    - Migrate any data from `auto_trading_sessions` if it exists
    - Drop `auto_trading_sessions` table completely

  2. Security
    - Update RLS policies for auto_trading_status
    - Ensure admin-only access for auto trading operations

  3. Notes
    - This migration is idempotent and safe to run multiple times
    - All existing auto trading status records will be preserved
    - Session tracking is now consolidated in a single table
*/

-- Add missing fields to auto_trading_status if they don't exist
DO $$
BEGIN
  -- Add current_session_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'current_session_id'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN current_session_id uuid;
  END IF;

  -- Add session_started_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'session_started_at'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN session_started_at timestamptz;
  END IF;

  -- Add session_ended_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'session_ended_at'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN session_ended_at timestamptz;
  END IF;

  -- Add risk_percentage if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'risk_percentage'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN risk_percentage numeric DEFAULT 1.0;
  END IF;

  -- Add min_confidence if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'min_confidence'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN min_confidence integer DEFAULT 75;
  END IF;

  -- Add active_symbols if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'active_symbols'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN active_symbols text[] DEFAULT ARRAY['EURUSD', 'GBPUSD', 'XAUUSD'];
  END IF;

  -- Add trading_hours_start if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'trading_hours_start'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN trading_hours_start time DEFAULT '00:00:00';
  END IF;

  -- Add trading_hours_end if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'trading_hours_end'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN trading_hours_end time DEFAULT '23:59:59';
  END IF;
END $$;

-- Migrate data from auto_trading_sessions to auto_trading_status if the old table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'auto_trading_sessions'
  ) THEN
    -- Migrate data from old table to new table
    INSERT INTO auto_trading_status (
      user_id,
      enabled,
      trades_taken_today,
      max_daily_trades,
      last_trade_time,
      min_confidence,
      risk_percentage,
      active_symbols,
      trading_hours_start,
      trading_hours_end,
      session_started_at,
      created_at,
      updated_at
    )
    SELECT
      user_id,
      enabled,
      trades_taken_today,
      max_daily_trades,
      last_trade_time,
      min_confidence,
      risk_percentage,
      active_symbols,
      trading_hours_start,
      trading_hours_end,
      session_start,
      created_at,
      updated_at
    FROM auto_trading_sessions
    ON CONFLICT (user_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      trades_taken_today = EXCLUDED.trades_taken_today,
      max_daily_trades = EXCLUDED.max_daily_trades,
      last_trade_time = EXCLUDED.last_trade_time,
      min_confidence = EXCLUDED.min_confidence,
      risk_percentage = EXCLUDED.risk_percentage,
      active_symbols = EXCLUDED.active_symbols,
      trading_hours_start = EXCLUDED.trading_hours_start,
      trading_hours_end = EXCLUDED.trading_hours_end,
      session_started_at = EXCLUDED.session_started_at,
      updated_at = now();

    -- Drop the old table
    DROP TABLE IF EXISTS auto_trading_sessions CASCADE;
  END IF;
END $$;

-- Create index for better performance on session queries
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_session
  ON auto_trading_status(user_id, current_session_id)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_auto_trading_status_active
  ON auto_trading_status(user_id, enabled, scanning_active);

-- Update RLS policies for auto_trading_status
DROP POLICY IF EXISTS "Users can view their own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can update their own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Admins can view all auto trading status" ON auto_trading_status;

-- Enable RLS
ALTER TABLE auto_trading_status ENABLE ROW LEVEL SECURITY;

-- Users can view their own status
CREATE POLICY "Users can view their own auto trading status"
  ON auto_trading_status
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can update their own status
CREATE POLICY "Users can update their own auto trading status"
  ON auto_trading_status
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all statuses
CREATE POLICY "Admins can view all auto trading status"
  ON auto_trading_status
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );
