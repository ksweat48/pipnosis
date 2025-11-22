/*
  # Create Missing AI Pattern Tables

  This migration creates the missing tables that are causing 404 errors in the console:
  - ai_pattern_discoveries: Tracks discovered trading patterns
  - ai_pattern_graduations: Tracks pattern graduation to production
  - ai_skill_tracking: Tracks AI skill development (referenced in diagnostics)

  ## New Tables

  ### ai_pattern_discoveries
  Stores discovered patterns with their performance metrics
  - pattern_name: Name/description of the pattern
  - symbol: Currency pair
  - timeframe: Trading timeframe
  - win_rate: Pattern success rate
  - trade_count: Number of times pattern observed
  - pattern_ev: Expected value of the pattern
  - is_active: Whether pattern is currently being used
  - discovery_date: When pattern was first identified

  ### ai_pattern_graduations
  Tracks patterns that have graduated to production use
  - pattern_id: Reference to pattern discovery
  - graduation_date: When pattern graduated
  - graduation_reason: Why it graduated
  - pre_graduation_stats: Performance before graduation
  - post_graduation_stats: Performance after graduation

  ### ai_skill_tracking
  Tracks overall AI skill development
  - skill_level: Current skill level (1-6)
  - skill_points: Accumulated skill points
  - trades_analyzed: Total trades analyzed
  - patterns_learned: Patterns discovered
  - win_rate_avg: Average win rate
  - profit_factor_avg: Average profit factor

  ## Security
  - Enable RLS on all tables
  - Users can only access their own data
*/

-- Create ai_pattern_discoveries table
CREATE TABLE IF NOT EXISTS ai_pattern_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_name text NOT NULL,
  pattern_description text,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  win_rate numeric DEFAULT 0,
  trade_count integer DEFAULT 0,
  total_profit numeric DEFAULT 0,
  avg_profit numeric DEFAULT 0,
  pattern_ev numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  discovery_date timestamptz DEFAULT now(),
  last_observed_at timestamptz,
  observation_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create ai_pattern_graduations table
CREATE TABLE IF NOT EXISTS ai_pattern_graduations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_id uuid REFERENCES ai_pattern_discoveries(id) ON DELETE CASCADE,
  pattern_name text NOT NULL,
  graduation_date timestamptz DEFAULT now(),
  graduation_reason text,
  pre_graduation_stats jsonb DEFAULT '{}'::jsonb,
  post_graduation_stats jsonb DEFAULT '{}'::jsonb,
  current_performance jsonb DEFAULT '{}'::jsonb,
  is_still_effective boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create ai_skill_tracking table
CREATE TABLE IF NOT EXISTS ai_skill_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  skill_level integer DEFAULT 1,
  skill_points numeric DEFAULT 0,
  trades_analyzed integer DEFAULT 0,
  patterns_learned integer DEFAULT 0,
  win_rate_avg numeric DEFAULT 0,
  profit_factor_avg numeric DEFAULT 0,
  consistency_score numeric DEFAULT 0,
  learning_velocity numeric DEFAULT 0,
  last_skill_update timestamptz DEFAULT now(),
  milestones_achieved jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_pattern_discoveries_user_id ON ai_pattern_discoveries(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_discoveries_symbol ON ai_pattern_discoveries(symbol);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_discoveries_active ON ai_pattern_discoveries(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_discoveries_ev ON ai_pattern_discoveries(pattern_ev DESC);

CREATE INDEX IF NOT EXISTS idx_ai_pattern_graduations_user_id ON ai_pattern_graduations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_graduations_pattern_id ON ai_pattern_graduations(pattern_id);

CREATE INDEX IF NOT EXISTS idx_ai_skill_tracking_user_id ON ai_skill_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_skill_tracking_level ON ai_skill_tracking(skill_level);

-- Enable Row Level Security
ALTER TABLE ai_pattern_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pattern_graduations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_skill_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_pattern_discoveries
CREATE POLICY "Users can view own pattern discoveries"
  ON ai_pattern_discoveries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pattern discoveries"
  ON ai_pattern_discoveries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pattern discoveries"
  ON ai_pattern_discoveries FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pattern discoveries"
  ON ai_pattern_discoveries FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ai_pattern_graduations
CREATE POLICY "Users can view own pattern graduations"
  ON ai_pattern_graduations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pattern graduations"
  ON ai_pattern_graduations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pattern graduations"
  ON ai_pattern_graduations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pattern graduations"
  ON ai_pattern_graduations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for ai_skill_tracking
CREATE POLICY "Users can view own skill tracking"
  ON ai_skill_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own skill tracking"
  ON ai_skill_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own skill tracking"
  ON ai_skill_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own skill tracking"
  ON ai_skill_tracking FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
