/*
  # Update Auto-Backtest System for 30-Day Progressive Learning

  1. Schema Changes
    - Update `auto_backtest_global_state` table to track monthly sessions with daily progress
    - Add new columns for tracking current day within month
    - Add monthly parent session ID for grouping 30 days together
    - Rename columns from "backtest" terminology to "month" terminology

  2. Changes Made
    - Add `current_day_in_month` (1-30)
    - Add `total_months_completed`
    - Add `current_month_number`
    - Add `monthly_parent_session_id`
    - Update last result tracking to be "last_day" instead of "last_backtest"
    - Remove old cycle-based meta-learning columns if they exist

  3. Notes
    - Each monthly session = 30 daily trade sessions
    - AI learns progressively after each day
    - All 30 days grouped under one parent session
*/

-- Add new columns for 30-day monthly system
DO $$
BEGIN
  -- Add monthly tracking columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'current_day_in_month') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN current_day_in_month INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'total_months_completed') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN total_months_completed INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'current_month_number') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN current_month_number INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'monthly_parent_session_id') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN monthly_parent_session_id TEXT;
  END IF;

  -- Add daily result tracking columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'last_day_number') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN last_day_number INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'last_day_session_name') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN last_day_session_name TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'last_day_win_rate') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN last_day_win_rate NUMERIC;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'last_day_total_trades') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN last_day_total_trades INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'last_day_pnl') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN last_day_pnl NUMERIC;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'last_day_completed_at') THEN
    ALTER TABLE auto_backtest_global_state ADD COLUMN last_day_completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add helpful comment
COMMENT ON TABLE auto_backtest_global_state IS '30-Day Progressive Learning System: Each auto-backtest session runs for 30 days with daily learning';
COMMENT ON COLUMN auto_backtest_global_state.current_day_in_month IS 'Current day within the 30-day month (1-30)';
COMMENT ON COLUMN auto_backtest_global_state.total_months_completed IS 'Total number of completed 30-day monthly sessions';
COMMENT ON COLUMN auto_backtest_global_state.current_month_number IS 'Current month number in progress';
COMMENT ON COLUMN auto_backtest_global_state.monthly_parent_session_id IS 'Parent session ID grouping all 30 daily sessions';
