/*
  # Add Soft Closing Status to Goal Sessions

  ## Changes
  
  1. Status Updates
    - Add 'soft_closing' status to goal_sessions (text field allows it)
    - This status indicates timeframe expired but trades are still open
  
  2. New Tracking Fields
    - `timeframe_expired_at` - Timestamp when time limit was reached
    - `trades_open_at_expiration` - Count of active trades when timeframe expired
    - `soft_close_duration_minutes` - How long trades took to finish after expiration
  
  3. Purpose
    - Enables graceful session completion without disrupting active trades
    - Blocks new trades after expiration while allowing existing trades to complete
    - Tracks performance during soft close period for analytics
  
  ## Security
    - Maintains existing RLS policies
    - No changes to access control
*/

-- Add tracking fields for soft close behavior
ALTER TABLE goal_sessions 
  ADD COLUMN IF NOT EXISTS timeframe_expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS trades_open_at_expiration integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soft_close_duration_minutes integer;

-- Add check constraint to ensure valid status values (including new 'soft_closing')
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'goal_sessions_status_check'
  ) THEN
    ALTER TABLE goal_sessions 
      ADD CONSTRAINT goal_sessions_status_check 
      CHECK (status IN (
        'initializing', 
        'scanning', 
        'trade_pending', 
        'in_trade', 
        'soft_closing',
        'goal_achieved', 
        'expired', 
        'user_stopped'
      ));
  END IF;
END $$;

-- Create index for querying sessions in soft_closing state
CREATE INDEX IF NOT EXISTS idx_goal_sessions_soft_closing 
  ON goal_sessions(status) 
  WHERE status = 'soft_closing';

-- Create index for timeframe expiration queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_timeframe_expired 
  ON goal_sessions(timeframe_expired_at) 
  WHERE timeframe_expired_at IS NOT NULL;

-- Add comment explaining the soft_closing status
COMMENT ON COLUMN goal_sessions.timeframe_expired_at IS 
  'Timestamp when the session timeframe ended. Trades may continue after this point.';
  
COMMENT ON COLUMN goal_sessions.trades_open_at_expiration IS 
  'Number of trades that were still open when the timeframe expired.';
  
COMMENT ON COLUMN goal_sessions.soft_close_duration_minutes IS 
  'Minutes elapsed between timeframe expiration and final trade close.';