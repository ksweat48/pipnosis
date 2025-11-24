/*
  # Add Goal Session Link to Trade History

  1. Schema Changes
    - Add `goal_session_id` column to `trade_history` table
    - Create foreign key relationship to `goal_sessions` table
    - Add index for efficient queries by goal session
    - Allow NULL values for backwards compatibility with existing trades

  2. Purpose
    - Link trades to goal sessions for unified tracking
    - Enable session-based P&L calculations
    - Support journaling and learning systems
    - Maintain data consistency between goal_session_trades and trade_history

  3. Security
    - No RLS changes needed (existing policies handle this through user_id)
*/

-- Add goal_session_id column to trade_history
ALTER TABLE trade_history
ADD COLUMN IF NOT EXISTS goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL;

-- Create index for efficient queries by goal session
CREATE INDEX IF NOT EXISTS idx_trade_history_goal_session
  ON trade_history(goal_session_id) 
  WHERE goal_session_id IS NOT NULL;

-- Create composite index for user + goal session queries
CREATE INDEX IF NOT EXISTS idx_trade_history_user_goal_session
  ON trade_history(user_id, goal_session_id)
  WHERE goal_session_id IS NOT NULL;