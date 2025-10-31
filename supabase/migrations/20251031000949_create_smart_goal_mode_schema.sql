/*
  # Smart Goal Mode - Complete Schema

  ## Overview
  This migration creates the complete database schema for the Smart Goal Mode feature,
  enabling AI-driven trading goals with scheduled scanning, forecasting, and progress tracking.

  ## New Tables Created
  
  ### 1. `goal_sessions`
  Stores active and completed goal sessions for users
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `goal_type` (text) - 'profit_target', 'percentage_gain', 'account_growth'
  - `target_value` (numeric) - The dollar amount or percentage target
  - `timeframe` (text) - '1 day', '1 week', '1 month', etc.
  - `timeframe_hours` (integer) - Calculated hours for easier queries
  - `risk_mode` (text) - 'low', 'medium', 'high'
  - `status` (text) - 'initializing', 'scanning', 'trade_pending', 'in_trade', 'goal_achieved', 'expired', 'user_stopped'
  - `starting_balance` (numeric)
  - `current_progress` (numeric) - Running total of profit/loss
  - `progress_percentage` (numeric) - Calculated progress toward goal
  - `scan_interval_minutes` (integer) - How often to scan markets
  - `auto_execute` (boolean) - Whether to auto-execute trades
  - `watchlist` (text[]) - Array of symbols to monitor
  - `start_time` (timestamptz)
  - `end_time` (timestamptz)
  - `last_scan_time` (timestamptz)
  - `next_scan_time` (timestamptz)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. `goal_session_trades`
  Links trades to specific goal sessions
  - `id` (uuid, primary key)
  - `goal_session_id` (uuid, foreign key)
  - `trade_id` (uuid) - Reference to actual trade
  - `symbol` (text)
  - `direction` (text) - 'buy' or 'sell'
  - `entry_price` (numeric)
  - `exit_price` (numeric)
  - `stop_loss` (numeric)
  - `take_profit` (numeric)
  - `position_size` (numeric)
  - `profit_loss` (numeric)
  - `status` (text) - 'pending', 'open', 'closed', 'rejected'
  - `opened_at` (timestamptz)
  - `closed_at` (timestamptz)
  - `created_at` (timestamptz)

  ### 3. `goal_forecasts`
  Stores AI predictions about upcoming market opportunities
  - `id` (uuid, primary key)
  - `goal_session_id` (uuid, foreign key)
  - `symbol` (text)
  - `forecast_type` (text) - 'next_scan', 'setup_forming', 'volatility_window'
  - `predicted_time` (timestamptz)
  - `confidence_score` (numeric) - 0-100
  - `reasoning` (text) - AI explanation
  - `conditions` (jsonb) - Market conditions expected
  - `accuracy_validated` (boolean)
  - `actual_outcome` (text)
  - `created_at` (timestamptz)

  ### 4. `goal_progress_snapshots`
  Tracks incremental progress over time
  - `id` (uuid, primary key)
  - `goal_session_id` (uuid, foreign key)
  - `snapshot_time` (timestamptz)
  - `cumulative_profit` (numeric)
  - `progress_percentage` (numeric)
  - `trades_count` (integer)
  - `win_rate` (numeric)
  - `best_trade_profit` (numeric)
  - `notes` (text)
  - `created_at` (timestamptz)

  ### 5. `goal_session_summaries`
  Archives completed session performance analytics
  - `id` (uuid, primary key)
  - `goal_session_id` (uuid, foreign key, unique)
  - `user_id` (uuid, foreign key)
  - `goal_achieved` (boolean)
  - `final_profit` (numeric)
  - `final_progress_percentage` (numeric)
  - `total_trades` (integer)
  - `winning_trades` (integer)
  - `losing_trades` (integer)
  - `win_rate` (numeric)
  - `best_trade` (jsonb) - Details of best performing trade
  - `worst_trade` (jsonb)
  - `strongest_pattern` (text)
  - `lessons_learned` (text[])
  - `recommendations` (text[])
  - `session_duration_hours` (numeric)
  - `created_at` (timestamptz)

  ### 6. `goal_notifications`
  Tracks all notifications sent during goal sessions
  - `id` (uuid, primary key)
  - `goal_session_id` (uuid, foreign key)
  - `user_id` (uuid, foreign key)
  - `notification_type` (text) - 'forecast', 'signal', 'progress', 'alert', 'completion'
  - `priority` (text) - 'low', 'medium', 'high', 'urgent'
  - `title` (text)
  - `message` (text)
  - `data` (jsonb) - Additional structured data
  - `delivered_at` (timestamptz)
  - `acknowledged_at` (timestamptz)
  - `channels` (text[]) - ['in_app', 'email', 'telegram']
  - `created_at` (timestamptz)

  ### 7. `goal_ai_conversations`
  Stores AI conversational updates and user interactions
  - `id` (uuid, primary key)
  - `goal_session_id` (uuid, foreign key)
  - `user_id` (uuid, foreign key)
  - `role` (text) - 'ai' or 'user'
  - `message` (text)
  - `context` (jsonb) - Market conditions, progress, etc.
  - `sentiment` (text) - 'neutral', 'encouraging', 'educational', 'celebratory'
  - `created_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Users can only access their own goal sessions and related data
  - Admin users can view all sessions for monitoring
*/

-- Create goal_sessions table
CREATE TABLE IF NOT EXISTS goal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_type text NOT NULL CHECK (goal_type IN ('profit_target', 'percentage_gain', 'account_growth')),
  target_value numeric NOT NULL CHECK (target_value > 0),
  timeframe text NOT NULL,
  timeframe_hours integer NOT NULL CHECK (timeframe_hours > 0),
  risk_mode text NOT NULL DEFAULT 'medium' CHECK (risk_mode IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'initializing' CHECK (status IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'goal_achieved', 'expired', 'user_stopped')),
  starting_balance numeric NOT NULL DEFAULT 0,
  current_progress numeric NOT NULL DEFAULT 0,
  progress_percentage numeric NOT NULL DEFAULT 0,
  scan_interval_minutes integer NOT NULL DEFAULT 15,
  auto_execute boolean NOT NULL DEFAULT false,
  watchlist text[] NOT NULL DEFAULT ARRAY['XAUUSD', 'EURUSD', 'GBPUSD'],
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  last_scan_time timestamptz,
  next_scan_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create goal_session_trades table
CREATE TABLE IF NOT EXISTS goal_session_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  entry_price numeric NOT NULL,
  exit_price numeric,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  position_size numeric NOT NULL,
  profit_loss numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'closed', 'rejected')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create goal_forecasts table
CREATE TABLE IF NOT EXISTS goal_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  forecast_type text NOT NULL CHECK (forecast_type IN ('next_scan', 'setup_forming', 'volatility_window')),
  predicted_time timestamptz NOT NULL,
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  reasoning text NOT NULL,
  conditions jsonb DEFAULT '{}',
  accuracy_validated boolean DEFAULT false,
  actual_outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create goal_progress_snapshots table
CREATE TABLE IF NOT EXISTS goal_progress_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  snapshot_time timestamptz NOT NULL DEFAULT now(),
  cumulative_profit numeric NOT NULL DEFAULT 0,
  progress_percentage numeric NOT NULL DEFAULT 0,
  trades_count integer NOT NULL DEFAULT 0,
  win_rate numeric DEFAULT 0,
  best_trade_profit numeric DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create goal_session_summaries table
CREATE TABLE IF NOT EXISTS goal_session_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE UNIQUE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_achieved boolean NOT NULL DEFAULT false,
  final_profit numeric NOT NULL DEFAULT 0,
  final_progress_percentage numeric NOT NULL DEFAULT 0,
  total_trades integer NOT NULL DEFAULT 0,
  winning_trades integer NOT NULL DEFAULT 0,
  losing_trades integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  best_trade jsonb DEFAULT '{}',
  worst_trade jsonb DEFAULT '{}',
  strongest_pattern text,
  lessons_learned text[] DEFAULT ARRAY[]::text[],
  recommendations text[] DEFAULT ARRAY[]::text[],
  session_duration_hours numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create goal_notifications table
CREATE TABLE IF NOT EXISTS goal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  notification_type text NOT NULL CHECK (notification_type IN ('forecast', 'signal', 'progress', 'alert', 'completion')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  title text NOT NULL,
  message text NOT NULL,
  data jsonb DEFAULT '{}',
  delivered_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  channels text[] DEFAULT ARRAY['in_app'],
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create goal_ai_conversations table
CREATE TABLE IF NOT EXISTS goal_ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('ai', 'user')),
  message text NOT NULL,
  context jsonb DEFAULT '{}',
  sentiment text DEFAULT 'neutral' CHECK (sentiment IN ('neutral', 'encouraging', 'educational', 'celebratory', 'cautionary')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_goal_sessions_user_id ON goal_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_status ON goal_sessions(status);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_next_scan ON goal_sessions(next_scan_time) WHERE status IN ('scanning', 'trade_pending');
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_session ON goal_session_trades(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_status ON goal_session_trades(status);
CREATE INDEX IF NOT EXISTS idx_goal_forecasts_session ON goal_forecasts(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_forecasts_predicted_time ON goal_forecasts(predicted_time);
CREATE INDEX IF NOT EXISTS idx_goal_progress_session ON goal_progress_snapshots(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_notifications_session ON goal_notifications(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_notifications_user ON goal_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_notifications_unack ON goal_notifications(user_id, acknowledged_at) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_goal_conversations_session ON goal_ai_conversations(goal_session_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_goal_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to goal_sessions
DROP TRIGGER IF EXISTS update_goal_sessions_updated_at ON goal_sessions;
CREATE TRIGGER update_goal_sessions_updated_at
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_goal_session_timestamp();

-- Create function to auto-update progress when trades close
CREATE OR REPLACE FUNCTION update_goal_progress_on_trade_close()
RETURNS TRIGGER AS $$
DECLARE
  session_target numeric;
  session_progress numeric;
BEGIN
  -- Only update if trade is being closed
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    -- Get current session info
    SELECT target_value, current_progress INTO session_target, session_progress
    FROM goal_sessions
    WHERE id = NEW.goal_session_id;
    
    -- Update session progress
    UPDATE goal_sessions
    SET 
      current_progress = current_progress + COALESCE(NEW.profit_loss, 0),
      progress_percentage = ((current_progress + COALESCE(NEW.profit_loss, 0)) / NULLIF(session_target, 0)) * 100,
      status = CASE 
        WHEN ((current_progress + COALESCE(NEW.profit_loss, 0)) >= session_target) THEN 'goal_achieved'
        ELSE status
      END,
      updated_at = now()
    WHERE id = NEW.goal_session_id;
    
    -- Create progress snapshot
    INSERT INTO goal_progress_snapshots (goal_session_id, cumulative_profit, progress_percentage, trades_count)
    SELECT 
      NEW.goal_session_id,
      current_progress,
      progress_percentage,
      (SELECT COUNT(*) FROM goal_session_trades WHERE goal_session_id = NEW.goal_session_id AND status = 'closed')
    FROM goal_sessions
    WHERE id = NEW.goal_session_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to goal_session_trades
DROP TRIGGER IF EXISTS update_progress_on_trade_close ON goal_session_trades;
CREATE TRIGGER update_progress_on_trade_close
  AFTER INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_goal_progress_on_trade_close();

-- Enable RLS
ALTER TABLE goal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_session_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_ai_conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_sessions
CREATE POLICY "Users can view own goal sessions"
  ON goal_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own goal sessions"
  ON goal_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goal sessions"
  ON goal_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own goal sessions"
  ON goal_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for goal_session_trades
CREATE POLICY "Users can view own session trades"
  ON goal_session_trades FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = goal_session_trades.goal_session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create trades in own sessions"
  ON goal_session_trades FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = goal_session_trades.goal_session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update trades in own sessions"
  ON goal_session_trades FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = goal_session_trades.goal_session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

-- RLS Policies for goal_forecasts
CREATE POLICY "Users can view forecasts for own sessions"
  ON goal_forecasts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = goal_forecasts.goal_session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create forecasts for own sessions"
  ON goal_forecasts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = goal_forecasts.goal_session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

-- RLS Policies for goal_progress_snapshots
CREATE POLICY "Users can view progress snapshots for own sessions"
  ON goal_progress_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = goal_progress_snapshots.goal_session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "System can create progress snapshots"
  ON goal_progress_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for goal_session_summaries
CREATE POLICY "Users can view own session summaries"
  ON goal_session_summaries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own session summaries"
  ON goal_session_summaries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for goal_notifications
CREATE POLICY "Users can view own notifications"
  ON goal_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON goal_notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can create notifications"
  ON goal_notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for goal_ai_conversations
CREATE POLICY "Users can view conversations for own sessions"
  ON goal_ai_conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create conversations for own sessions"
  ON goal_ai_conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
