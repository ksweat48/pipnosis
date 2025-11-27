/*
  # Goal Achievement Rewards System

  ## Overview
  Enhances the reward system to recognize and celebrate goal achievements with
  significant score bonuses, streak tracking, and achievement milestones.

  ## Changes

  1. **ai_trader_score table enhancements**
     - Add `total_goals_achieved` - Lifetime count of goals hit
     - Add `goal_streak` - Current consecutive goals achieved
     - Add `best_goal_streak` - Record consecutive goal streak
     - Add `goals_this_month` - Monthly goal counter (resets)
     - Add `largest_goal_achieved` - Biggest goal amount ever hit
     - Add `last_goal_date` - Date of last goal achievement

  2. **goal_reward_history table (new)**
     - Tracks every goal achievement reward
     - Records score changes, bonuses, and factors
     - Links to goal_achievements for analytics

  ## Reward Structure
  - Base goal bonus: 25-75 points (based on goal size)
  - Speed bonuses: up to +15 points
  - User choice bonuses: +5-10 points
  - Final outcome bonuses: up to +15 points
  - Streak multipliers: 1.2x to 2.0x
  
  Maximum possible reward: ~150+ points for perfect legendary goal with 5+ streak

  ## Security
  - RLS policies ensure users can only see their own reward history
  - Goal rewards validated against achievement records
*/

-- Add goal tracking columns to ai_trader_score
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_trader_score' AND column_name = 'total_goals_achieved'
  ) THEN
    ALTER TABLE ai_trader_score ADD COLUMN total_goals_achieved INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_trader_score' AND column_name = 'goal_streak'
  ) THEN
    ALTER TABLE ai_trader_score ADD COLUMN goal_streak INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_trader_score' AND column_name = 'best_goal_streak'
  ) THEN
    ALTER TABLE ai_trader_score ADD COLUMN best_goal_streak INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_trader_score' AND column_name = 'goals_this_month'
  ) THEN
    ALTER TABLE ai_trader_score ADD COLUMN goals_this_month INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_trader_score' AND column_name = 'largest_goal_achieved'
  ) THEN
    ALTER TABLE ai_trader_score ADD COLUMN largest_goal_achieved DECIMAL(10, 2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_trader_score' AND column_name = 'last_goal_date'
  ) THEN
    ALTER TABLE ai_trader_score ADD COLUMN last_goal_date TIMESTAMPTZ;
  END IF;
END $$;

-- Create goal_reward_history table
CREATE TABLE IF NOT EXISTS goal_reward_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_achievement_id UUID NOT NULL REFERENCES goal_achievements(id) ON DELETE CASCADE,
  
  -- Reward details
  reward_type TEXT NOT NULL, -- 'goal_achieved', 'choice_bonus', 'final_outcome'
  score_change INTEGER NOT NULL,
  old_score INTEGER NOT NULL,
  new_score INTEGER NOT NULL,
  
  -- Breakdown
  base_bonus INTEGER DEFAULT 0,
  speed_bonus INTEGER DEFAULT 0,
  choice_bonus INTEGER DEFAULT 0,
  outcome_bonus INTEGER DEFAULT 0,
  streak_multiplier DECIMAL(3, 2) DEFAULT 1.0,
  
  -- Context
  goal_size_tier TEXT, -- 'small', 'medium', 'large', 'massive'
  goal_amount DECIMAL(10, 2),
  time_to_achieve_hours DECIMAL(10, 2),
  user_choice TEXT,
  final_outcome TEXT,
  
  -- Factors (human-readable explanations)
  reward_factors JSONB,
  
  -- Personality impact
  old_personality TEXT,
  new_personality TEXT,
  personality_changed BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_goal_reward_history_user_id ON goal_reward_history(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_reward_history_achievement_id ON goal_reward_history(goal_achievement_id);
CREATE INDEX IF NOT EXISTS idx_goal_reward_history_created_at ON goal_reward_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_reward_history_reward_type ON goal_reward_history(reward_type);

-- Enable RLS
ALTER TABLE goal_reward_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_reward_history' 
    AND policyname = 'Users can view own goal reward history'
  ) THEN
    CREATE POLICY "Users can view own goal reward history"
      ON goal_reward_history FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'goal_reward_history' 
    AND policyname = 'Service role has full access to goal reward history'
  ) THEN
    CREATE POLICY "Service role has full access to goal reward history"
      ON goal_reward_history FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Function to reset monthly goal counter (run via cron on 1st of each month)
CREATE OR REPLACE FUNCTION reset_monthly_goal_counters()
RETURNS void AS $$
BEGIN
  UPDATE ai_trader_score
  SET goals_this_month = 0
  WHERE goals_this_month > 0;
  
  RAISE NOTICE 'Monthly goal counters reset for all users';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON TABLE goal_reward_history IS 'Tracks all goal achievement rewards with detailed breakdown';
COMMENT ON COLUMN ai_trader_score.total_goals_achieved IS 'Lifetime count of goals achieved';
COMMENT ON COLUMN ai_trader_score.goal_streak IS 'Current consecutive goals achieved';
COMMENT ON COLUMN ai_trader_score.best_goal_streak IS 'Best consecutive goal streak ever';
COMMENT ON COLUMN ai_trader_score.goals_this_month IS 'Goals achieved this calendar month';
COMMENT ON COLUMN ai_trader_score.largest_goal_achieved IS 'Largest goal amount ever achieved';
COMMENT ON COLUMN ai_trader_score.last_goal_date IS 'Date of last goal achievement';
