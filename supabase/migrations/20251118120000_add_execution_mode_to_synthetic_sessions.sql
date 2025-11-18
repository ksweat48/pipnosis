/*
  # Add execution_mode to synthetic_backtest_sessions

  1. Changes
    - Add `execution_mode` column to track whether session is MANUAL or AUTO
    - Add index for filtering by execution_mode
    - Set default to 'MANUAL' for existing sessions

  2. Purpose
    - Allows users to distinguish between manually triggered backtests and auto-backtest sessions
    - Enables proper filtering and display in UI
*/

-- Add execution_mode column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'synthetic_backtest_sessions'
    AND column_name = 'execution_mode'
  ) THEN
    ALTER TABLE synthetic_backtest_sessions
    ADD COLUMN execution_mode text DEFAULT 'MANUAL' CHECK (execution_mode IN ('MANUAL', 'AUTO'));

    -- Add index for efficient filtering
    CREATE INDEX IF NOT EXISTS idx_synthetic_sessions_execution_mode
      ON synthetic_backtest_sessions(execution_mode, created_at DESC);

    -- Add comment
    COMMENT ON COLUMN synthetic_backtest_sessions.execution_mode IS
      'Indicates if session was triggered manually or by auto-backtest system';
  END IF;
END $$;
