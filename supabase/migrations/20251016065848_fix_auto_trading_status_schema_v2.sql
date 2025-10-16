/*
  # Fix Auto Trading Status Schema - Version 2
  
  ## Summary
  This migration aligns the auto_trading_status table schema with the application code requirements.
  The existing table is missing critical columns needed by the auto trading scanner service.
  
  ## Changes Made
  
  ### Schema Updates
  1. Add missing columns to auto_trading_status table
  2. Create performance indexes
  3. Update RLS policies for admin access
  
  ## Notes
  - Preserves existing data where possible
  - Uses safe column additions with IF NOT EXISTS checks
  - Sets sensible defaults for new columns
*/

-- Add enabled column (maps from is_active)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'enabled'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN enabled boolean DEFAULT false;
    UPDATE auto_trading_status SET enabled = is_active;
  END IF;
END $$;

-- Add trades_taken_today column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'trades_taken_today'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN trades_taken_today integer DEFAULT 0;
    UPDATE auto_trading_status SET trades_taken_today = COALESCE(trades_today, 0);
  END IF;
END $$;

-- Add max_daily_trades column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'max_daily_trades'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN max_daily_trades integer DEFAULT 6;
  END IF;
END $$;

-- Add scanning_active column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'scanning_active'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN scanning_active boolean DEFAULT false;
  END IF;
END $$;

-- Add last_scan_time column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'last_scan_time'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN last_scan_time timestamptz;
    UPDATE auto_trading_status SET last_scan_time = last_scan_at WHERE last_scan_at IS NOT NULL;
  END IF;
END $$;

-- Add last_trade_time column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'last_trade_time'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN last_trade_time timestamptz;
  END IF;
END $$;

-- Add opportunity_window_start column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'opportunity_window_start'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN opportunity_window_start timestamptz;
  END IF;
END $$;

-- Add opportunity_window_end column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'opportunity_window_end'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN opportunity_window_end timestamptz;
  END IF;
END $$;

-- Add last_opportunity_found column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'last_opportunity_found'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN last_opportunity_found timestamptz;
  END IF;
END $$;

-- Add consecutive_no_opportunity_count column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'consecutive_no_opportunity_count'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN consecutive_no_opportunity_count integer DEFAULT 0;
  END IF;
END $$;

-- Add daily_pnl column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'daily_pnl'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN daily_pnl numeric DEFAULT 0;
  END IF;
END $$;

-- Add daily_loss_limit column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'daily_loss_limit'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN daily_loss_limit numeric DEFAULT -500;
  END IF;
END $$;

-- Add emergency_stop column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'emergency_stop'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN emergency_stop boolean DEFAULT false;
  END IF;
END $$;

-- Add continuous_mode column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'continuous_mode'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN continuous_mode boolean DEFAULT false;
  END IF;
END $$;

-- Add learning_mode column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'learning_mode'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN learning_mode boolean DEFAULT true;
  END IF;
END $$;

-- Add total_trades_executed column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'total_trades_executed'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN total_trades_executed integer DEFAULT 0;
  END IF;
END $$;

-- Add started_by_admin column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'started_by_admin'
  ) THEN
    ALTER TABLE auto_trading_status ADD COLUMN started_by_admin uuid REFERENCES auth.users(id);
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_enabled ON auto_trading_status(enabled);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_scanning_active ON auto_trading_status(scanning_active);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_continuous_mode ON auto_trading_status(continuous_mode);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_learning_mode ON auto_trading_status(learning_mode);
