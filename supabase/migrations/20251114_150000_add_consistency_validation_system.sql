/*
  # Add AI Consistency Validation System

  1. New Tables
    - `ai_session_wr_tracking`
      - Tracks win rate for each backtest session to calculate 10-session spread
      - Used to ensure AI maintains consistent performance (max 10% spread)
    - `ai_session_pf_tracking`
      - Tracks profit factor for each backtest session
      - Used to calculate 10-session average for level advancement validation
    - `ai_applied_adjustments`
      - Logs all automatic adjustments applied by the AI learning system
      - Provides audit trail and effectiveness tracking

  2. Changes to Existing Tables
    - Add learning cycle tracking fields to `ai_skill_progression`
    - Add consistency validation fields to track session-based requirements

  3. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users to access their own data
*/

-- ============================================
-- AI Session Win Rate Tracking Table
-- ============================================
CREATE TABLE IF NOT EXISTS ai_session_wr_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  session_date timestamptz NOT NULL DEFAULT now(),
  win_rate decimal(5,2) NOT NULL,
  wins_count integer NOT NULL DEFAULT 0,
  total_trades integer NOT NULL DEFAULT 0,
  backtest_type text NOT NULL CHECK (backtest_type IN ('live', 'backtest', 'synthetic')),
  symbol text,
  timeframe text,
  strategy_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, session_id)
);

-- Add index for efficient 10-session queries
CREATE INDEX IF NOT EXISTS idx_ai_session_wr_tracking_user_date
  ON ai_session_wr_tracking(user_id, session_date DESC);

-- Enable RLS
ALTER TABLE ai_session_wr_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own WR session tracking"
  ON ai_session_wr_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own WR session tracking"
  ON ai_session_wr_tracking
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- AI Session Profit Factor Tracking Table
-- ============================================
CREATE TABLE IF NOT EXISTS ai_session_pf_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  session_date timestamptz NOT NULL DEFAULT now(),
  profit_factor decimal(5,2) NOT NULL,
  total_wins_value decimal(10,2) NOT NULL DEFAULT 0,
  total_losses_value decimal(10,2) NOT NULL DEFAULT 0,
  backtest_type text NOT NULL CHECK (backtest_type IN ('live', 'backtest', 'synthetic')),
  symbol text,
  timeframe text,
  strategy_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, session_id)
);

-- Add index for efficient 10-session queries
CREATE INDEX IF NOT EXISTS idx_ai_session_pf_tracking_user_date
  ON ai_session_pf_tracking(user_id, session_date DESC);

-- Enable RLS
ALTER TABLE ai_session_pf_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own PF session tracking"
  ON ai_session_pf_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own PF session tracking"
  ON ai_session_pf_tracking
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- AI Applied Adjustments Log Table
-- ============================================
CREATE TABLE IF NOT EXISTS ai_applied_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN (
    'confidence_adjustment',
    'filter_threshold',
    'pattern_adoption',
    'pattern_rejection',
    'indicator_weight',
    'risk_parameter',
    'strategy_parameter',
    'other'
  )),
  target_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reasoning text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  effectiveness_score decimal(5,2),
  was_beneficial boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add index for querying adjustments by user and date
CREATE INDEX IF NOT EXISTS idx_ai_applied_adjustments_user_date
  ON ai_applied_adjustments(user_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_applied_adjustments_cycle
  ON ai_applied_adjustments(user_id, cycle_number DESC);

-- Enable RLS
ALTER TABLE ai_applied_adjustments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own applied adjustments"
  ON ai_applied_adjustments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applied adjustments"
  ON ai_applied_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- Update ai_skill_progression Table
-- ============================================

-- Add learning cycle tracking fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'current_cycle_position'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN current_cycle_position integer NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'total_cycles_completed'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN total_cycles_completed integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'last_cycle_completion_date'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN last_cycle_completion_date timestamptz;
  END IF;

  -- Consistency validation tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'last_10_session_wr_spread'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN last_10_session_wr_spread decimal(5,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'last_10_session_pf_average'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN last_10_session_pf_average decimal(5,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'consistency_validation_passed'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN consistency_validation_passed boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'consistency_failure_reason'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN consistency_failure_reason text;
  END IF;
END $$;

-- ============================================
-- Helper Functions for Consistency Validation
-- ============================================

-- Function to calculate WR spread over last 10 sessions
CREATE OR REPLACE FUNCTION calculate_wr_spread_last_10_sessions(p_user_id uuid)
RETURNS decimal AS $$
DECLARE
  v_max_wr decimal;
  v_min_wr decimal;
  v_spread decimal;
  v_session_count integer;
BEGIN
  -- Get count of sessions
  SELECT COUNT(*) INTO v_session_count
  FROM ai_session_wr_tracking
  WHERE user_id = p_user_id
  ORDER BY session_date DESC
  LIMIT 10;

  -- Need at least 10 sessions to calculate spread
  IF v_session_count < 10 THEN
    RETURN 0;
  END IF;

  -- Calculate max and min WR from last 10 sessions
  SELECT
    MAX(win_rate),
    MIN(win_rate)
  INTO v_max_wr, v_min_wr
  FROM (
    SELECT win_rate
    FROM ai_session_wr_tracking
    WHERE user_id = p_user_id
    ORDER BY session_date DESC
    LIMIT 10
  ) last_10;

  -- Calculate spread
  v_spread := COALESCE(v_max_wr - v_min_wr, 0);

  RETURN v_spread;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate PF average over last 10 sessions
CREATE OR REPLACE FUNCTION calculate_pf_average_last_10_sessions(p_user_id uuid)
RETURNS decimal AS $$
DECLARE
  v_avg_pf decimal;
  v_session_count integer;
BEGIN
  -- Get count of sessions
  SELECT COUNT(*) INTO v_session_count
  FROM ai_session_pf_tracking
  WHERE user_id = p_user_id
  ORDER BY session_date DESC
  LIMIT 10;

  -- Need at least 10 sessions to calculate average
  IF v_session_count < 10 THEN
    RETURN 0;
  END IF;

  -- Calculate average PF from last 10 sessions
  SELECT AVG(profit_factor)
  INTO v_avg_pf
  FROM (
    SELECT profit_factor
    FROM ai_session_pf_tracking
    WHERE user_id = p_user_id
    ORDER BY session_date DESC
    LIMIT 10
  ) last_10;

  RETURN COALESCE(v_avg_pf, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to check if user has minimum 10 sessions
CREATE OR REPLACE FUNCTION has_minimum_sessions_for_consistency(p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_wr_count integer;
  v_pf_count integer;
BEGIN
  SELECT COUNT(*) INTO v_wr_count
  FROM ai_session_wr_tracking
  WHERE user_id = p_user_id;

  SELECT COUNT(*) INTO v_pf_count
  FROM ai_session_pf_tracking
  WHERE user_id = p_user_id;

  RETURN (v_wr_count >= 10 AND v_pf_count >= 10);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments for Documentation
-- ============================================

COMMENT ON TABLE ai_session_wr_tracking IS 'Tracks win rate for each backtest session to calculate 10-session spread for consistency validation';
COMMENT ON TABLE ai_session_pf_tracking IS 'Tracks profit factor for each backtest session to calculate 10-session average for level advancement';
COMMENT ON TABLE ai_applied_adjustments IS 'Logs all automatic adjustments applied by the AI learning system every 10 sessions';

COMMENT ON FUNCTION calculate_wr_spread_last_10_sessions IS 'Calculates the spread (max - min) of win rates over the last 10 sessions. Must be ≤10% to advance levels.';
COMMENT ON FUNCTION calculate_pf_average_last_10_sessions IS 'Calculates average profit factor over last 10 sessions for consistency validation';
COMMENT ON FUNCTION has_minimum_sessions_for_consistency IS 'Checks if user has completed at least 10 sessions for consistency validation';
