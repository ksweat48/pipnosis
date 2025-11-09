/*
  # AI Skill Tracking & Indicator Experimentation System

  This migration creates a comprehensive system for tracking AI learning progression,
  skill levels, indicator experimentation, and performance evolution.

  ## New Tables Created

  1. `ai_skill_progression`
     - Tracks the AI's skill level evolution over time
     - Stores current level (Novice, Intermediate, Pro, Expert, Master, Exceptional)
     - Calculates progress towards next level
     - Records total trades analyzed, win rate trends, learning velocity

  2. `ai_learning_milestones`
     - Records significant achievements and breakthroughs
     - Tracks when AI reaches new skill levels
     - Stores milestone metadata and timestamp

  3. `ai_indicator_experiments`
     - Tracks which technical indicators AI is testing
     - Records experiment start date, status, and results
     - Stores sample size and performance metrics per indicator

  4. `ai_indicator_effectiveness`
     - Stores win rate and performance for each indicator
     - Tracks indicator combinations that work well together
     - Records effectiveness by symbol, timeframe, and market condition

  5. `ai_indicator_usage_history`
     - Historical record of when AI adopted or dropped indicators
     - Tracks reasoning for indicator changes
     - Enables analysis of indicator evolution over time

  ## Security
  - RLS enabled on all tables
  - Users can only see their own AI learning data
  - Authenticated users can read and write their own records
*/

-- =====================================================
-- TABLE: ai_skill_progression
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_skill_progression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Skill Level Info
  current_skill_level text NOT NULL CHECK (current_skill_level IN ('Novice', 'Intermediate', 'Pro', 'Expert', 'Master', 'Exceptional')),
  skill_level_numeric integer NOT NULL DEFAULT 1, -- 1=Novice, 2=Intermediate, 3=Pro, 4=Expert, 5=Master, 6=Exceptional
  progress_to_next_level_percent numeric(5,2) NOT NULL DEFAULT 0,

  -- Cumulative Stats
  total_trades_analyzed integer NOT NULL DEFAULT 0,
  total_backtests_completed integer NOT NULL DEFAULT 0,
  total_synthetic_backtests integer NOT NULL DEFAULT 0,
  total_real_backtests integer NOT NULL DEFAULT 0,

  -- Performance Metrics
  current_win_rate numeric(5,2) NOT NULL DEFAULT 0,
  target_win_rate numeric(5,2) NOT NULL DEFAULT 80.00,
  gap_to_target numeric(5,2) NOT NULL DEFAULT 80.00,
  current_profit_factor numeric(10,2) NOT NULL DEFAULT 0,
  current_confidence_accuracy numeric(5,2) NOT NULL DEFAULT 0, -- How often high confidence signals succeed

  -- Learning Velocity
  learning_velocity_score numeric(5,2) NOT NULL DEFAULT 0, -- How fast AI is improving (trades/percentage improvement)
  win_rate_30d_change numeric(5,2) NOT NULL DEFAULT 0,
  win_rate_60d_change numeric(5,2) NOT NULL DEFAULT 0,
  win_rate_90d_change numeric(5,2) NOT NULL DEFAULT 0,

  -- Level Thresholds & Estimates
  trades_needed_for_next_level integer NOT NULL DEFAULT 0,
  estimated_days_to_next_level integer,
  estimated_trades_to_master integer,
  estimated_trades_to_exceptional integer,

  -- Pattern Recognition
  total_patterns_learned integer NOT NULL DEFAULT 0,
  winning_patterns_count integer NOT NULL DEFAULT 0,
  losing_patterns_count integer NOT NULL DEFAULT 0,
  pattern_recognition_accuracy numeric(5,2) NOT NULL DEFAULT 0,

  -- Last Level Up Info
  previous_skill_level text,
  last_level_up_date timestamptz,
  last_level_up_trade_count integer,

  -- Metadata
  first_trade_analyzed_date timestamptz,
  last_trade_analyzed_date timestamptz,
  last_backtest_session_id uuid,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ai_skill_progression_user
  ON ai_skill_progression(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_skill_progression_level
  ON ai_skill_progression(user_id, skill_level_numeric);

-- =====================================================
-- TABLE: ai_learning_milestones
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_learning_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  milestone_type text NOT NULL CHECK (milestone_type IN (
    'skill_level_up', 'trade_count', 'win_rate_target', 'pattern_discovered',
    'indicator_mastery', 'profit_milestone', 'consistency_achievement'
  )),

  milestone_title text NOT NULL,
  milestone_description text NOT NULL,

  -- Context
  achieved_at timestamptz DEFAULT now(),
  skill_level_at_achievement text,
  total_trades_at_achievement integer,
  win_rate_at_achievement numeric(5,2),

  -- Metadata
  related_session_id uuid,
  celebration_shown boolean DEFAULT false,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_milestones_user
  ON ai_learning_milestones(user_id, achieved_at DESC);

-- =====================================================
-- TABLE: ai_indicator_experiments
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_indicator_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Indicator Info
  indicator_name text NOT NULL, -- e.g., 'RSI', 'MACD', 'Bollinger Bands', 'Stochastic', 'ATR'
  indicator_category text NOT NULL CHECK (indicator_category IN (
    'momentum', 'trend', 'volatility', 'volume', 'custom', 'composite'
  )),
  indicator_parameters jsonb, -- e.g., {"period": 14, "overbought": 70, "oversold": 30}

  -- Experiment Status
  experiment_status text NOT NULL DEFAULT 'testing' CHECK (experiment_status IN (
    'testing', 'adopted', 'rejected', 'under_review'
  )),

  started_testing_date timestamptz DEFAULT now(),
  completed_testing_date timestamptz,

  -- Performance Metrics
  trades_with_indicator integer NOT NULL DEFAULT 0,
  wins_with_indicator integer NOT NULL DEFAULT 0,
  losses_with_indicator integer NOT NULL DEFAULT 0,
  win_rate_with_indicator numeric(5,2) NOT NULL DEFAULT 0,
  avg_profit_with_indicator numeric(10,2) NOT NULL DEFAULT 0,

  -- Comparison (trades without this indicator)
  trades_without_indicator integer NOT NULL DEFAULT 0,
  win_rate_without_indicator numeric(5,2) NOT NULL DEFAULT 0,

  -- A/B Test Results
  improvement_vs_baseline numeric(5,2) NOT NULL DEFAULT 0, -- Positive = better, Negative = worse
  statistical_significance numeric(5,2), -- p-value or confidence level

  -- AI Decision
  adoption_decision text,
  adoption_reasoning text,
  rejection_reasoning text,

  -- Metadata
  symbols_tested text[] DEFAULT ARRAY[]::text[],
  timeframes_tested text[] DEFAULT ARRAY[]::text[],
  market_conditions_tested text[] DEFAULT ARRAY[]::text[],

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_indicator_experiments_user
  ON ai_indicator_experiments(user_id, experiment_status);
CREATE INDEX IF NOT EXISTS idx_ai_indicator_experiments_name
  ON ai_indicator_experiments(user_id, indicator_name);

-- =====================================================
-- TABLE: ai_indicator_effectiveness
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_indicator_effectiveness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Indicator Details
  indicator_name text NOT NULL,
  indicator_combination text[], -- If multiple indicators used together
  is_combination boolean DEFAULT false,

  -- Context
  symbol text NOT NULL,
  timeframe text NOT NULL,
  market_condition text, -- 'trending_up', 'trending_down', 'ranging', 'high_volatility', etc.

  -- Effectiveness Metrics
  total_signals integer NOT NULL DEFAULT 0,
  signals_taken integer NOT NULL DEFAULT 0,
  signals_won integer NOT NULL DEFAULT 0,
  signals_lost integer NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  avg_profit_per_signal numeric(10,2) NOT NULL DEFAULT 0,
  profit_factor numeric(10,2) NOT NULL DEFAULT 0,

  -- Confidence & Quality
  avg_confidence_when_present numeric(5,2),
  signal_quality_score numeric(5,2) NOT NULL DEFAULT 0, -- Overall effectiveness rating 0-100

  -- Usage Status
  is_currently_active boolean DEFAULT true,
  weight_in_decision numeric(5,2) DEFAULT 50.00, -- How much influence this indicator has (0-100)

  -- Historical Tracking
  first_used_date timestamptz,
  last_used_date timestamptz,
  times_indicator_changed_decision integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_indicator_effectiveness_user
  ON ai_indicator_effectiveness(user_id, symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_ai_indicator_effectiveness_active
  ON ai_indicator_effectiveness(user_id, is_currently_active);
CREATE INDEX IF NOT EXISTS idx_ai_indicator_effectiveness_quality
  ON ai_indicator_effectiveness(user_id, signal_quality_score DESC);

-- =====================================================
-- TABLE: ai_indicator_usage_history
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_indicator_usage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  indicator_name text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('adopted', 'dropped', 'weight_increased', 'weight_decreased', 'parameters_adjusted')),

  -- Context
  action_date timestamptz DEFAULT now(),
  skill_level_at_action text,
  total_trades_at_action integer,

  -- Reasoning
  reasoning text NOT NULL,
  performance_before jsonb, -- Win rate, profit factor before change
  expected_improvement text,

  -- Results (filled in later after more trades)
  performance_after jsonb,
  actual_improvement numeric(5,2),
  was_beneficial boolean,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_indicator_usage_history_user
  ON ai_indicator_usage_history(user_id, action_date DESC);

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- ai_skill_progression
ALTER TABLE ai_skill_progression ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI skill progression"
  ON ai_skill_progression FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI skill progression"
  ON ai_skill_progression FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI skill progression"
  ON ai_skill_progression FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ai_learning_milestones
ALTER TABLE ai_learning_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI learning milestones"
  ON ai_learning_milestones FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI learning milestones"
  ON ai_learning_milestones FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ai_indicator_experiments
ALTER TABLE ai_indicator_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI indicator experiments"
  ON ai_indicator_experiments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI indicator experiments"
  ON ai_indicator_experiments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI indicator experiments"
  ON ai_indicator_experiments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ai_indicator_effectiveness
ALTER TABLE ai_indicator_effectiveness ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI indicator effectiveness"
  ON ai_indicator_effectiveness FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI indicator effectiveness"
  ON ai_indicator_effectiveness FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI indicator effectiveness"
  ON ai_indicator_effectiveness FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ai_indicator_usage_history
ALTER TABLE ai_indicator_usage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI indicator usage history"
  ON ai_indicator_usage_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI indicator usage history"
  ON ai_indicator_usage_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to calculate skill level based on trades and performance
CREATE OR REPLACE FUNCTION calculate_skill_level(
  total_trades integer,
  win_rate numeric,
  profit_factor numeric
) RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  -- Novice: 0-100 trades
  IF total_trades < 100 THEN
    RETURN 'Novice';
  -- Intermediate: 101-500 trades with >45% win rate
  ELSIF total_trades < 500 AND win_rate >= 45 THEN
    RETURN 'Intermediate';
  -- Pro: 501-1500 trades with >55% win rate and >1.2 profit factor
  ELSIF total_trades < 1500 AND win_rate >= 55 AND profit_factor >= 1.2 THEN
    RETURN 'Pro';
  -- Expert: 1501-5000 trades with >65% win rate and >1.5 profit factor
  ELSIF total_trades < 5000 AND win_rate >= 65 AND profit_factor >= 1.5 THEN
    RETURN 'Expert';
  -- Master: 5001-10000 trades with >70% win rate and >1.8 profit factor
  ELSIF total_trades < 10000 AND win_rate >= 70 AND profit_factor >= 1.8 THEN
    RETURN 'Master';
  -- Exceptional: 10000+ trades with >80% win rate and >2.0 profit factor
  ELSIF total_trades >= 10000 AND win_rate >= 80 AND profit_factor >= 2.0 THEN
    RETURN 'Exceptional';
  -- If trades are sufficient but performance isn't, stay at current level
  ELSIF total_trades >= 10000 THEN
    RETURN 'Master';
  ELSIF total_trades >= 5000 THEN
    RETURN 'Expert';
  ELSIF total_trades >= 1500 THEN
    RETURN 'Pro';
  ELSIF total_trades >= 500 THEN
    RETURN 'Intermediate';
  ELSE
    RETURN 'Novice';
  END IF;
END;
$$;

-- Function to get skill level numeric value
CREATE OR REPLACE FUNCTION get_skill_level_numeric(level text) RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN CASE level
    WHEN 'Novice' THEN 1
    WHEN 'Intermediate' THEN 2
    WHEN 'Pro' THEN 3
    WHEN 'Expert' THEN 4
    WHEN 'Master' THEN 5
    WHEN 'Exceptional' THEN 6
    ELSE 1
  END;
END;
$$;
