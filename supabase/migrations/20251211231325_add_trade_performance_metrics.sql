/*
  # Add Trade Performance Metrics

  This migration adds detailed trade performance tracking to goal_session_trades:

  1. New Columns
    - `max_drawdown` (numeric): Maximum adverse price movement (drawdown) during the trade
    - `max_profit` (numeric): Maximum favorable price movement (MFE - Maximum Favorable Excursion) during the trade
    - `total_pips` (numeric): Total pip movement from entry to exit
    - `close_reason` (text): Reason for trade closure (if not already present)
    - `user_id` (uuid): User reference for easier querying

  2. Purpose
    - Track peak profit (MFE) to understand missed opportunities
    - Track maximum drawdown to assess risk management
    - Track pip movement for technical analysis
    - Enable comprehensive trade analysis and learning

  3. Notes
    - max_drawdown stores the worst unrealized loss during the trade (negative value)
    - max_profit stores the best unrealized profit during the trade (positive value)
    - total_pips calculates the actual pip movement achieved
*/

-- Add new columns to goal_session_trades
DO $$
BEGIN
  -- Add max_drawdown column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'max_drawdown'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN max_drawdown numeric DEFAULT 0;
  END IF;

  -- Add max_profit column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'max_profit'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN max_profit numeric DEFAULT 0;
  END IF;

  -- Add total_pips column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'total_pips'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN total_pips numeric DEFAULT 0;
  END IF;

  -- Add close_reason column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'close_reason'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN close_reason text DEFAULT 'manual';
  END IF;

  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Populate user_id from goal_sessions for existing trades
UPDATE goal_session_trades gst
SET user_id = gs.user_id
FROM goal_sessions gs
WHERE gst.goal_session_id = gs.id
AND gst.user_id IS NULL;

-- Create index for efficient queries by user
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_id
ON goal_session_trades(user_id);

-- Create index for closed trades queries
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_status_closed
ON goal_session_trades(status, closed_at DESC)
WHERE status = 'closed';

-- Add comment to document the new columns
COMMENT ON COLUMN goal_session_trades.max_drawdown IS 'Maximum adverse price movement during the trade (negative value represents largest unrealized loss)';
COMMENT ON COLUMN goal_session_trades.max_profit IS 'Maximum favorable price movement during the trade (MFE - Maximum Favorable Excursion)';
COMMENT ON COLUMN goal_session_trades.total_pips IS 'Total pip movement from entry to exit price';
