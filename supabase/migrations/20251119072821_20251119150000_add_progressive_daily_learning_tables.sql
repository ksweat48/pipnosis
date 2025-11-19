/*
  # Add Progressive Daily Learning Tables

  ## Overview
  Create tables to support daily aggregation of learnings and weekly meta-analysis.
  This completes Phase 1.3 of the learning system upgrade.

  ## Tables
  1. daily_learning_aggregations - Daily summary of trades, patterns, and insights
  2. weekly_meta_analyses - Weekly strategic analysis and recommendations
  3. user_trading_preferences - Dynamic threshold adjustments

  ## Security
  - RLS policies for user isolation
  - Authenticated user access only
*/

-- ============================================================================
-- TABLE 1: Daily Learning Aggregations
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_learning_aggregations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  
  -- Performance Metrics
  total_trades integer NOT NULL,
  win_rate numeric NOT NULL,
  profit_factor numeric NOT NULL,
  
  -- Pattern Analysis
  top_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Insights
  key_insights text[] NOT NULL DEFAULT '{}',
  recommended_adjustments text[] NOT NULL DEFAULT '{}',
  estimated_improvement_potential text,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, date)
);

-- ============================================================================
-- TABLE 2: Weekly Meta Analyses
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekly_meta_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Week Definition
  week_start date NOT NULL,
  week_end date NOT NULL,
  
  -- Overall Performance
  overall_win_rate numeric NOT NULL,
  overall_profit_factor numeric NOT NULL,
  
  -- Day Analysis
  best_days text[] NOT NULL DEFAULT '{}',
  worst_days text[] NOT NULL DEFAULT '{}',
  
  -- Strategic Guidance
  strategic_recommendations text[] NOT NULL DEFAULT '{}',
  patterns_to_emphasize text[] NOT NULL DEFAULT '{}',
  patterns_to_avoid text[] NOT NULL DEFAULT '{}',
  
  -- Calibration
  confidence_calibration jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, week_start, week_end)
);

-- ============================================================================
-- TABLE 3: User Trading Preferences
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_trading_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Dynamic Thresholds
  min_confidence_threshold integer DEFAULT 75,
  risk_multiplier numeric DEFAULT 1.0,
  
  -- Trading Style
  preferred_symbols text[] DEFAULT '{"EURUSD", "XAUUSD", "GBPUSD"}',
  preferred_timeframes text[] DEFAULT '{"M15", "H1"}',
  
  -- Risk Management
  max_daily_trades integer DEFAULT 10,
  max_daily_loss numeric DEFAULT 100,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- Add ai_validated column to trade_history if not exists
-- ============================================================================

ALTER TABLE trade_history
ADD COLUMN IF NOT EXISTS ai_validated boolean DEFAULT false;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_daily_learning_aggregations_user_date
ON daily_learning_aggregations(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_meta_analyses_user_week
ON weekly_meta_analyses(user_id, week_end DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_ai_validated
ON trade_history(user_id, ai_validated) WHERE ai_validated = false;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE daily_learning_aggregations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_meta_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trading_preferences ENABLE ROW LEVEL SECURITY;

-- Daily Learning Aggregations Policies
CREATE POLICY "Users can view own daily aggregations"
  ON daily_learning_aggregations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own daily aggregations"
  ON daily_learning_aggregations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily aggregations"
  ON daily_learning_aggregations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Weekly Meta Analyses Policies
CREATE POLICY "Users can view own weekly analyses"
  ON weekly_meta_analyses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own weekly analyses"
  ON weekly_meta_analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- User Trading Preferences Policies
CREATE POLICY "Users can view own preferences"
  ON user_trading_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own preferences"
  ON user_trading_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON user_trading_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get last 7 days aggregations
CREATE OR REPLACE FUNCTION get_last_week_aggregations(p_user_id uuid)
RETURNS TABLE(
  date date,
  total_trades integer,
  win_rate numeric,
  profit_factor numeric,
  top_patterns jsonb,
  key_insights text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dla.date,
    dla.total_trades,
    dla.win_rate,
    dla.profit_factor,
    dla.top_patterns,
    dla.key_insights
  FROM daily_learning_aggregations dla
  WHERE dla.user_id = p_user_id
    AND dla.date >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY dla.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to trigger daily aggregation
CREATE OR REPLACE FUNCTION trigger_daily_aggregation(p_user_id uuid, p_date date)
RETURNS boolean AS $$
DECLARE
  v_trade_count integer;
BEGIN
  -- Check if there are trades for this date
  SELECT COUNT(*)
  INTO v_trade_count
  FROM trade_history
  WHERE user_id = p_user_id
    AND DATE(closed_at) = p_date;
  
  -- Return true if trades exist (aggregation should run)
  RETURN v_trade_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE daily_learning_aggregations IS
'Daily summary of trading performance, patterns, and insights. Used for progressive learning.';

COMMENT ON TABLE weekly_meta_analyses IS
'Weekly meta-analysis providing strategic recommendations based on 7 days of trading data.';

COMMENT ON TABLE user_trading_preferences IS
'User-specific trading preferences including dynamically adjusted confidence thresholds.';

COMMENT ON FUNCTION get_last_week_aggregations IS
'Returns the last 7 days of daily learning aggregations for a user.';

COMMENT ON FUNCTION trigger_daily_aggregation IS
'Checks if daily aggregation should run for a specific date (returns true if trades exist).';
