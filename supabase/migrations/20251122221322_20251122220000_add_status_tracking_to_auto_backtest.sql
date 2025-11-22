/*
  # Add Status Tracking to Auto-Backtest System

  1. New Columns
    - `last_status_message` (text) - Human-readable status of current operation
    - `last_status_updated_at` (timestamptz) - When status was last updated

  2. Purpose
    - Enable real-time progress tracking in UI
    - Help debug when backtest gets stuck
    - Provide better user feedback

  3. Changes
    - Add columns if they don't exist (idempotent)
    - No data migration needed
*/

-- Add status tracking columns to auto_backtest_global_state table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state'
    AND column_name = 'last_status_message'
  ) THEN
    ALTER TABLE auto_backtest_global_state
    ADD COLUMN last_status_message text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state'
    AND column_name = 'last_status_updated_at'
  ) THEN
    ALTER TABLE auto_backtest_global_state
    ADD COLUMN last_status_updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create index for faster status queries
CREATE INDEX IF NOT EXISTS idx_auto_backtest_status_updated
ON auto_backtest_global_state(last_status_updated_at DESC);

-- Add helpful comment
COMMENT ON COLUMN auto_backtest_global_state.last_status_message IS 'Human-readable status message for debugging and UI display';
COMMENT ON COLUMN auto_backtest_global_state.last_status_updated_at IS 'Timestamp of last status update';
