/*
  # Add Auto Trading Persistence Columns

  1. Purpose
    - Add missing columns needed for auto trading persistence
    - Enable database-driven scheduling and heartbeat tracking
    - Fix 400 Bad Request error when starting auto trading

  2. Changes
    - Add should_be_scanning column for persistent state tracking
    - Add scan_interval_seconds for configurable scan frequency
    - Add next_scan_scheduled_at for database-driven scheduling
    - Add last_heartbeat_at for session liveness detection

  3. Security
    - Existing RLS policies will apply to these new columns
*/

-- Add persistence fields to auto_trading_status table
DO $$
BEGIN
  -- Add should_be_scanning column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'should_be_scanning'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN should_be_scanning boolean DEFAULT false;
  END IF;

  -- Add scan_interval_seconds column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'scan_interval_seconds'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN scan_interval_seconds integer DEFAULT 120;
  END IF;

  -- Add next_scan_scheduled_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'next_scan_scheduled_at'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN next_scan_scheduled_at timestamptz;
  END IF;

  -- Add last_heartbeat_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'last_heartbeat_at'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN last_heartbeat_at timestamptz;
  END IF;
END $$;

-- Add helpful comments
COMMENT ON COLUMN auto_trading_status.should_be_scanning IS 'Whether auto trading should be actively scanning - persists across page reloads';
COMMENT ON COLUMN auto_trading_status.scan_interval_seconds IS 'Seconds between scans (default 120 = 2 minutes)';
COMMENT ON COLUMN auto_trading_status.next_scan_scheduled_at IS 'Next time a scan should occur - used for database-driven scheduling';
COMMENT ON COLUMN auto_trading_status.last_heartbeat_at IS 'Last time the scanner reported it was alive - used to detect stale sessions';

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_auto_trading_next_scan
  ON auto_trading_status(next_scan_scheduled_at)
  WHERE should_be_scanning = true AND enabled = true;

CREATE INDEX IF NOT EXISTS idx_auto_trading_heartbeat
  ON auto_trading_status(last_heartbeat_at)
  WHERE should_be_scanning = true;
