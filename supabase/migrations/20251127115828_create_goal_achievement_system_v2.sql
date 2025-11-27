/*
  # Goal Achievement System

  ## Overview
  Implements a system where goals are marked as achieved when target P&L is reached,
  but gives users the choice to continue trading with protected stop losses.

  ## Changes

  1. **goal_sessions table enhancements**
     - Add `goal_achieved_at` - Timestamp when goal was reached
     - Add `goal_achieved_pnl` - P&L amount when goal was achieved
     - Add `user_choice` - What user chose to do after goal was hit
     - Add `final_pnl` - Actual final P&L after user's choice
     - Add `auto_close_on_goal` - Whether to auto-close or ask user

  2. **goal_achievements table (new)**
     - Permanent record of every goal achievement
     - Tracks user decision and final outcome
     - Used for statistics and AI learning

  3. **goal_notifications table enhancements**
     - Add `actions` column for action buttons
     - Add `action_taken` and `action_taken_at` for tracking user choices

  ## Security
  - RLS policies ensure users can only see their own goal achievements
  - Action buttons validated on backend
*/

-- Add new columns to goal_sessions table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'goal_achieved_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN goal_achieved_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'goal_achieved_pnl'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN goal_achieved_pnl DECIMAL(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'user_choice'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN user_choice TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'final_pnl'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN final_pnl DECIMAL(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'auto_close_on_goal'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN auto_close_on_goal BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Create goal_achievements table for permanent achievement records
CREATE TABLE IF NOT EXISTS goal_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id UUID NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  
  -- Achievement details
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  achieved_pnl DECIMAL(10, 2) NOT NULL,
  target_amount DECIMAL(10, 2) NOT NULL,
  
  -- User decision
  user_choice TEXT, -- 'close_now', 'continue_breakeven', 'continue_safety', 'default_breakeven'
  choice_made_at TIMESTAMPTZ,
  
  -- Final outcome
  final_pnl DECIMAL(10, 2),
  final_outcome TEXT, -- 'closed_at_goal', 'hit_tp', 'hit_sl_breakeven', 'hit_sl_safety', 'manual_close'
  completed_at TIMESTAMPTZ,
  
  -- Trade details at achievement
  trade_id UUID,
  symbol TEXT NOT NULL,
  entry_price DECIMAL(20, 5),
  current_price_at_achievement DECIMAL(20, 5),
  take_profit DECIMAL(20, 5),
  stop_loss_before DECIMAL(20, 5),
  stop_loss_after DECIMAL(20, 5),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_goal_achievements_user_id ON goal_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_achievements_session_id ON goal_achievements(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_goal_achievements_achieved_at ON goal_achievements(achieved_at DESC);

-- Enable RLS
ALTER TABLE goal_achievements ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_achievements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_achievements' 
    AND policyname = 'Users can view own goal achievements'
  ) THEN
    CREATE POLICY "Users can view own goal achievements"
      ON goal_achievements FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_achievements' 
    AND policyname = 'Users can insert own goal achievements'
  ) THEN
    CREATE POLICY "Users can insert own goal achievements"
      ON goal_achievements FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_achievements' 
    AND policyname = 'Users can update own goal achievements'
  ) THEN
    CREATE POLICY "Users can update own goal achievements"
      ON goal_achievements FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_achievements' 
    AND policyname = 'Service role has full access to goal achievements'
  ) THEN
    CREATE POLICY "Service role has full access to goal achievements"
      ON goal_achievements FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Add new columns to existing goal_notifications table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'actions'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN actions JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'action_taken'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN action_taken TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'action_taken_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN action_taken_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_goal_achievements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS goal_achievements_updated_at ON goal_achievements;
CREATE TRIGGER goal_achievements_updated_at
  BEFORE UPDATE ON goal_achievements
  FOR EACH ROW
  EXECUTE FUNCTION update_goal_achievements_updated_at();

-- Add comments for documentation
COMMENT ON TABLE goal_achievements IS 'Permanent record of goal achievements, tracks user decisions and final outcomes';
COMMENT ON COLUMN goal_notifications.actions IS 'JSON array of action buttons: [{id, label, description}]';
COMMENT ON COLUMN goal_notifications.action_taken IS 'Which action the user selected';
