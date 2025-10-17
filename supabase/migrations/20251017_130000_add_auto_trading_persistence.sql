/*
  # Auto Trading Persistence System

  1. Purpose
    - Enable auto trading to persist across page reloads and navigation
    - Store scanning schedule and state in database
    - Allow auto trading to continue even when browser is closed

  2. Changes
    - Add heartbeat tracking to monitor if scanning is active
    - Add next_scan_scheduled_at for database-driven scheduling
    - Add scan_interval_seconds for configurable scan frequency
    - Add last_heartbeat_at to detect stale sessions

  3. Security
    - RLS policies ensure users can only access their own auto trading state
*/

-- Add persistence fields to auto_trading_status table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'next_scan_scheduled_at'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN next_scan_scheduled_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'scan_interval_seconds'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN scan_interval_seconds integer DEFAULT 120;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'last_heartbeat_at'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN last_heartbeat_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'should_be_scanning'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN should_be_scanning boolean DEFAULT false;
  END IF;
END $$;

-- Add comment explaining persistence mechanism
COMMENT ON COLUMN auto_trading_status.next_scan_scheduled_at IS 'Next time a scan should occur - used for database-driven scheduling';
COMMENT ON COLUMN auto_trading_status.scan_interval_seconds IS 'Seconds between scans (default 120 = 2 minutes)';
COMMENT ON COLUMN auto_trading_status.last_heartbeat_at IS 'Last time the scanner reported it was alive - used to detect stale sessions';
COMMENT ON COLUMN auto_trading_status.should_be_scanning IS 'Whether auto trading should be actively scanning - persists across page reloads';

-- Create index for efficient querying of scheduled scans
CREATE INDEX IF NOT EXISTS idx_auto_trading_next_scan
  ON auto_trading_status(next_scan_scheduled_at)
  WHERE should_be_scanning = true AND enabled = true;

-- Create index for heartbeat monitoring
CREATE INDEX IF NOT EXISTS idx_auto_trading_heartbeat
  ON auto_trading_status(last_heartbeat_at)
  WHERE should_be_scanning = true;
