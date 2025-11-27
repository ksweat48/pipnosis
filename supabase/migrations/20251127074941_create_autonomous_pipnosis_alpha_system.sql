/*
  # Autonomous Pipnosis Alpha - Reward System

  1. New Tables
    - `ai_trader_score` - Score tracking
    - `ai_strategy_memory` - Strategy learning

  2. Enhanced Tables
    - `ai_trade_analysis` - Add reward/penalty fields
*/

CREATE TABLE IF NOT EXISTS ai_trader_score (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  current_score INTEGER NOT NULL DEFAULT 50,
  lifetime_profit NUMERIC DEFAULT 0,
  lifetime_loss NUMERIC DEFAULT 0,

  streak_wins INTEGER DEFAULT 0,
  streak_losses INTEGER DEFAULT 0,
  best_win_streak INTEGER DEFAULT 0,
  worst_loss_streak INTEGER DEFAULT 0,

  last_session_profit NUMERIC DEFAULT 0,
  last_session_trades INTEGER DEFAULT 0,
  last_session_date TIMESTAMPTZ,

  confidence_level TEXT DEFAULT 'balanced',
  risk_appetite NUMERIC DEFAULT 3.0,
  trading_style TEXT DEFAULT 'steady',

  total_trades INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  avg_rr NUMERIC DEFAULT 0,
  profit_factor NUMERIC DEFAULT 0,

  version INTEGER DEFAULT 1,
  last_update_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_trader_score_user ON ai_trader_score(user_id);
CREATE INDEX IF NOT EXISTS idx_trader_score_score ON ai_trader_score(current_score);

ALTER TABLE ai_trader_score ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trader score"
  ON ai_trader_score FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trader score"
  ON ai_trader_score FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trader score"
  ON ai_trader_score FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS ai_strategy_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  strategy_mode TEXT NOT NULL,
  conditions JSONB,
  entry_logic TEXT,
  sl_calculation TEXT,
  tp_calculation TEXT,
  market_context TEXT,

  times_used INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  breakevens INTEGER DEFAULT 0,
  total_profit NUMERIC DEFAULT 0,
  total_loss NUMERIC DEFAULT 0,

  success_rate NUMERIC DEFAULT 0,
  profit_factor NUMERIC DEFAULT 0,
  avg_rr NUMERIC DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  confidence_rating INTEGER DEFAULT 50,

  last_used_at TIMESTAMPTZ,
  first_used_at TIMESTAMPTZ DEFAULT NOW(),

  works_best_when TEXT,
  avoid_when TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_memory_user ON ai_strategy_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_memory_mode ON ai_strategy_memory(strategy_mode);

ALTER TABLE ai_strategy_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategy memory"
  ON ai_strategy_memory FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strategy memory"
  ON ai_strategy_memory FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategy memory"
  ON ai_strategy_memory FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own strategy memory"
  ON ai_strategy_memory FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='score_before') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN score_before INTEGER;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='score_after') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN score_after INTEGER;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='score_change') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN score_change INTEGER;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='reward_factors') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN reward_factors TEXT[];
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='strategy_mode') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN strategy_mode TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='conditions_used') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN conditions_used JSONB;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='why_won') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN why_won TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='why_lost') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN why_lost TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='what_to_repeat') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN what_to_repeat TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='what_to_avoid') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN what_to_avoid TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='timing_quality') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN timing_quality TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='execution_quality') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN execution_quality TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='lesson_learned') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN lesson_learned TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='duration_minutes') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN duration_minutes INTEGER;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='ai_trade_analysis' AND column_name='max_drawdown') THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN max_drawdown NUMERIC;
  END IF;
END $$;

INSERT INTO ai_trader_score (user_id, current_score)
SELECT id, 50 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;