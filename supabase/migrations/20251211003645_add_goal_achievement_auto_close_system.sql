/*
  # Goal Achievement Auto-Close System

  1. New Columns
    - `goal_session_trades` table:
      - `goal_met_at` (timestamptz) - When unrealized profit reached goal amount
      - `goal_met_price` (numeric) - Price when goal was first reached
      - `expected_profit_at_entry` (numeric) - Expected profit based on TP distance
      - `unrealized_goal_achievement` (boolean) - Flag if goal was reached before TP/SL

    - `goal_sessions` table:
      - `auto_close_on_goal` (boolean) - Whether to auto-close when goal is met
      - `user_response_to_close` (text) - User's choice after trade closes
      - `goal_met_but_continued` (boolean) - If goal was met but trade continued to TP

  2. New Table
    - `goal_trade_actions` - Track user responses to trade close events

  3. Security
    - RLS policies for authenticated users
*/

-- Add columns to goal_session_trades
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS goal_met_at timestamptz,
  ADD COLUMN IF NOT EXISTS goal_met_price numeric,
  ADD COLUMN IF NOT EXISTS expected_profit_at_entry numeric,
  ADD COLUMN IF NOT EXISTS unrealized_goal_achievement boolean DEFAULT false;

-- Add columns to goal_sessions
ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS auto_close_on_goal boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS user_response_to_close text,
  ADD COLUMN IF NOT EXISTS goal_met_but_continued boolean DEFAULT false;

-- Create goal_trade_actions table
CREATE TABLE IF NOT EXISTS goal_trade_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('start_new_session', 'continue_current', 'close_for_now')),
  trade_close_reason text, -- 'stop_loss', 'take_profit', 'manual', 'goal_met'
  profit_loss numeric,
  cumulative_progress numeric,
  target_value numeric,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE goal_trade_actions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_trade_actions
CREATE POLICY "Users can view own trade actions"
  ON goal_trade_actions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trade actions"
  ON goal_trade_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_goal_trade_actions_user_session
  ON goal_trade_actions(user_id, goal_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_goal_met
  ON goal_session_trades(goal_session_id, goal_met_at)
  WHERE goal_met_at IS NOT NULL;
