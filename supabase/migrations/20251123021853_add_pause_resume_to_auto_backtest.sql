/*
  # Add Pause/Resume Functionality to Auto-Backtest System

  1. New Columns
    - `is_paused` (boolean) - Tracks if auto-backtest is paused with saved position
    - `paused_at` (timestamptz) - When the backtest was paused
    - `resumed_at` (timestamptz) - When the backtest was last resumed

  2. State Logic
    - is_running = true, is_paused = false → Actively running
    - is_running = false, is_paused = true → Paused (position saved)
    - is_running = false, is_paused = false → Stopped (position cleared)

  3. Benefits
    - Users can pause long-running backtests
    - Position (month/day) preserved on pause
    - Resume continues from exact saved position
    - Stop & Reset clears all progress
    - Prevents accidental progress loss

  4. Security
    - RLS policies already in place
    - User can only pause/resume their own backtests
*/

-- Add is_paused column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'is_paused'
  ) THEN
    ALTER TABLE auto_backtest_global_state
    ADD COLUMN is_paused BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add paused_at timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'paused_at'
  ) THEN
    ALTER TABLE auto_backtest_global_state
    ADD COLUMN paused_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add resumed_at timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_global_state' AND column_name = 'resumed_at'
  ) THEN
    ALTER TABLE auto_backtest_global_state
    ADD COLUMN resumed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Update existing rows to have is_paused = false
UPDATE auto_backtest_global_state
SET is_paused = false
WHERE is_paused IS NULL;

-- Add helpful comments
COMMENT ON COLUMN auto_backtest_global_state.is_paused IS
  'TRUE = paused with saved position (month/day preserved), FALSE = either running or fully stopped';

COMMENT ON COLUMN auto_backtest_global_state.paused_at IS
  'Timestamp when the auto-backtest was paused';

COMMENT ON COLUMN auto_backtest_global_state.resumed_at IS
  'Timestamp when the auto-backtest was last resumed from pause';

-- Add index for quick pause state lookups
CREATE INDEX IF NOT EXISTS idx_auto_backtest_pause_state
ON auto_backtest_global_state(user_id, is_paused)
WHERE is_paused = true;

-- Add index for pause/resume tracking
CREATE INDEX IF NOT EXISTS idx_auto_backtest_pause_timestamps
ON auto_backtest_global_state(user_id, paused_at, resumed_at);
