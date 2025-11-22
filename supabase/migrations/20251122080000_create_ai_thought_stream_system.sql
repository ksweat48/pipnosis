/*
  # AI Thought Stream System

  Creates tables for capturing and displaying the AI's internal dialogue and learning narrative.

  ## New Tables
  
  ### `ai_thought_stream`
  Stores individual AI thoughts in natural language:
  - Individual thought entries with timestamp
  - Thought categories (observation, hypothesis, experiment, result, conclusion, goal_check)
  - Context linking to trades, patterns, or sessions
  - Confidence levels for each thought
  
  ### `ai_daily_reflections`
  End-of-session narrative summaries:
  - Daily paragraph-form reflections
  - Progress toward current goals
  - Key insights discovered
  - Challenges and adjustments
  - Tomorrow's focus areas

  ## Features
  - Natural language AI reasoning
  - 30-day rolling window (auto-cleanup)
  - Casual, conversational tone
  - Goal-oriented narrative
  - Real-time thought streaming capability

  ## Security
  - RLS enabled on all tables
  - Users can only view their own AI thoughts
  - Service role has full access for automated systems
*/

-- AI Thought Stream Table
CREATE TABLE IF NOT EXISTS ai_thought_stream (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Timestamp
  thought_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id TEXT, -- Link to daily session
  
  -- Thought Classification
  thought_category TEXT NOT NULL CHECK (thought_category IN (
    'observation',      -- "I noticed..."
    'hypothesis',       -- "I think... because..."
    'experiment',       -- "Trying... to see if..."
    'result',           -- "After testing... result was..."
    'conclusion',       -- "Learned... applying to..."
    'goal_progress',    -- "Current goal... progress..."
    'confusion',        -- "Not sure why..."
    'breakthrough',     -- "Major discovery..."
    'frustration',      -- "Struggling with..."
    'excitement'        -- "Really excited about..."
  )),
  
  -- The Thought (Natural Language)
  thought_text TEXT NOT NULL, -- The actual thought in plain English
  
  -- Context
  symbol TEXT,
  timeframe TEXT,
  metric_affected TEXT, -- win_rate, profit_factor, etc.
  
  -- Related Entities
  related_trade_id TEXT,
  related_pattern_id TEXT,
  related_session_id TEXT,
  
  -- Confidence
  confidence NUMERIC DEFAULT 75 CHECK (confidence >= 0 AND confidence <= 100),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI Daily Reflections Table
CREATE TABLE IF NOT EXISTS ai_daily_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Session Info
  session_date DATE NOT NULL,
  session_id TEXT,
  session_number INTEGER, -- Day 1, Day 2, etc.
  
  -- The Reflection (Paragraph Form)
  reflection_text TEXT NOT NULL, -- Main daily reflection
  
  -- Goal Progress
  current_goal TEXT, -- "Reach 65% win rate"
  goal_progress_percentage NUMERIC, -- How close to goal
  on_track BOOLEAN DEFAULT true,
  
  -- Key Insights
  key_discoveries TEXT[], -- Array of key learnings
  challenges_faced TEXT[], -- What was hard
  adjustments_made TEXT[], -- What the AI changed
  
  -- Performance Summary
  session_win_rate NUMERIC,
  session_profit_factor NUMERIC,
  trades_count INTEGER,
  
  -- Tomorrow's Focus
  tomorrow_focus TEXT[], -- What to work on next
  
  -- Emotional State
  mood TEXT CHECK (mood IN ('confident', 'curious', 'focused', 'frustrated', 'excited', 'cautious')),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, session_date)
);

-- Indexes for Performance
CREATE INDEX idx_thought_stream_user_time ON ai_thought_stream(user_id, thought_at DESC);
CREATE INDEX idx_thought_stream_category ON ai_thought_stream(user_id, thought_category);
CREATE INDEX idx_thought_stream_session ON ai_thought_stream(user_id, session_id);
CREATE INDEX idx_daily_reflections_user_date ON ai_daily_reflections(user_id, session_date DESC);

-- Enable Row Level Security
ALTER TABLE ai_thought_stream ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_daily_reflections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_thought_stream
CREATE POLICY "Users can view their own thoughts"
  ON ai_thought_stream FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert thoughts"
  ON ai_thought_stream FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update thoughts"
  ON ai_thought_stream FOR UPDATE
  TO service_role
  USING (true);

-- RLS Policies for ai_daily_reflections
CREATE POLICY "Users can view their own reflections"
  ON ai_daily_reflections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage reflections"
  ON ai_daily_reflections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Cleanup Function: Keep only last 30 sessions of thoughts
CREATE OR REPLACE FUNCTION cleanup_old_ai_thoughts()
RETURNS void AS $$
BEGIN
  -- Delete thoughts older than 30 days
  DELETE FROM ai_thought_stream
  WHERE thought_at < NOW() - INTERVAL '30 days';
  
  -- Delete reflections older than 30 days
  DELETE FROM ai_daily_reflections
  WHERE session_date < CURRENT_DATE - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup to run daily (if pg_cron is available)
-- This will be handled by application logic if pg_cron is not available
