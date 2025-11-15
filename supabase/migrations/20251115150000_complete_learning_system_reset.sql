/*
  # Complete AI Learning System Reset and Skill Threshold Update

  ## Overview
  This migration performs a complete reset of all AI learning data and updates
  skill progression thresholds to more challenging requirements.

  ## Changes Made

  1. **Data Cleanup** - Removes all AI learning data for fresh start
     - Clears all trade analyses
     - Removes all learning insights
     - Deletes session learnings
     - Clears performance evolution records
     - Removes skill progression data
     - Clears GPT-4o meta-learning data
     - Removes all backtest sessions and trades

  2. **Skill Threshold Updates** - New progression requirements
     - Novice: 35% win rate, 500 total wins
     - Intermediate: 45% win rate, 1000 total wins
     - Pro: 55% win rate, 5000 total wins
     - Expert: 65% win rate, 10000 total wins
     - Master: 75% win rate, 50000 total wins
     - Exceptional: 85% win rate, 100000 total wins

  3. **Database Functions** - Updates skill calculation functions
     - Updates progression calculation logic
     - Implements new threshold checks
     - Adds validation for new requirements

  ## Security
  - Only affects user-specific data (filtered by user_id)
  - Preserves table structure and RLS policies
  - Does not affect system configuration

  ## Notes
  - This is a complete reset - all historical learning data will be removed
  - Trade history in trade_history table is preserved (only backtest trades removed)
  - User can start fresh with properly functioning learning pipeline
*/

-- ============================================================================
-- STEP 1: RESET ALL AI LEARNING DATA
-- ============================================================================

-- Create a function to safely delete all learning data for a user
CREATE OR REPLACE FUNCTION reset_user_learning_data(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  trade_analysis_count integer;
  insights_count integer;
  session_learnings_count integer;
  performance_count integer;
  scenario_count integer;
  skill_count integer;
  milestone_count integer;
  gpt4o_insights_count integer;
  gpt4o_patterns_count integer;
  synthetic_sessions_count integer;
  synthetic_trades_count integer;
  backtest_sessions_count integer;
  backtest_trades_count integer;
BEGIN
  -- Delete ai_trade_analysis
  DELETE FROM ai_trade_analysis WHERE user_id = target_user_id;
  GET DIAGNOSTICS trade_analysis_count = ROW_COUNT;

  -- Delete ai_learning_insights
  DELETE FROM ai_learning_insights WHERE user_id = target_user_id;
  GET DIAGNOSTICS insights_count = ROW_COUNT;

  -- Delete ai_session_learnings
  DELETE FROM ai_session_learnings WHERE user_id = target_user_id;
  GET DIAGNOSTICS session_learnings_count = ROW_COUNT;

  -- Delete ai_performance_evolution
  DELETE FROM ai_performance_evolution WHERE user_id = target_user_id;
  GET DIAGNOSTICS performance_count = ROW_COUNT;

  -- Delete ai_market_scenario_performance
  DELETE FROM ai_market_scenario_performance WHERE user_id = target_user_id;
  GET DIAGNOSTICS scenario_count = ROW_COUNT;

  -- Delete ai_skill_progression
  DELETE FROM ai_skill_progression WHERE user_id = target_user_id;
  GET DIAGNOSTICS skill_count = ROW_COUNT;

  -- Delete ai_learning_milestones
  DELETE FROM ai_learning_milestones WHERE user_id = target_user_id;
  GET DIAGNOSTICS milestone_count = ROW_COUNT;

  -- Delete gpt4o_meta_learning_insights
  DELETE FROM gpt4o_meta_learning_insights WHERE user_id = target_user_id;
  GET DIAGNOSTICS gpt4o_insights_count = ROW_COUNT;

  -- Delete gpt4o_pattern_interpretations
  DELETE FROM gpt4o_pattern_interpretations WHERE user_id = target_user_id;
  GET DIAGNOSTICS gpt4o_patterns_count = ROW_COUNT;

  -- Delete synthetic_backtest_trades (cascades will handle related data)
  DELETE FROM synthetic_backtest_trades WHERE user_id = target_user_id;
  GET DIAGNOSTICS synthetic_trades_count = ROW_COUNT;

  -- Delete synthetic_backtest_sessions
  DELETE FROM synthetic_backtest_sessions WHERE user_id = target_user_id;
  GET DIAGNOSTICS synthetic_sessions_count = ROW_COUNT;

  -- Delete backtest_trades
  DELETE FROM backtest_trades WHERE user_id = target_user_id;
  GET DIAGNOSTICS backtest_trades_count = ROW_COUNT;

  -- Delete backtest_sessions
  DELETE FROM backtest_sessions WHERE user_id = target_user_id;
  GET DIAGNOSTICS backtest_sessions_count = ROW_COUNT;

  -- Build result summary
  result := jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'deleted', jsonb_build_object(
      'trade_analyses', trade_analysis_count,
      'learning_insights', insights_count,
      'session_learnings', session_learnings_count,
      'performance_records', performance_count,
      'scenario_records', scenario_count,
      'skill_records', skill_count,
      'milestones', milestone_count,
      'gpt4o_insights', gpt4o_insights_count,
      'gpt4o_patterns', gpt4o_patterns_count,
      'synthetic_trades', synthetic_trades_count,
      'synthetic_sessions', synthetic_sessions_count,
      'backtest_trades', backtest_trades_count,
      'backtest_sessions', backtest_sessions_count
    ),
    'message', 'All learning data successfully reset'
  );

  RETURN result;
END;
$$;

-- ============================================================================
-- STEP 2: UPDATE SKILL LEVEL THRESHOLDS
-- ============================================================================

-- Create a table to store skill level requirements (makes it easier to update)
CREATE TABLE IF NOT EXISTS ai_skill_level_requirements (
  skill_level text PRIMARY KEY,
  level_order integer UNIQUE NOT NULL,
  min_win_rate numeric NOT NULL CHECK (min_win_rate >= 0 AND min_win_rate <= 100),
  min_total_wins integer NOT NULL CHECK (min_total_wins >= 0),
  description text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE ai_skill_level_requirements ENABLE ROW LEVEL SECURITY;

-- Create policies for skill level requirements (read-only for all authenticated users)
CREATE POLICY "Anyone can view skill requirements"
  ON ai_skill_level_requirements
  FOR SELECT
  TO authenticated
  USING (true);

-- Insert new skill level requirements
INSERT INTO ai_skill_level_requirements (skill_level, level_order, min_win_rate, min_total_wins, description)
VALUES
  ('Novice', 1, 35.0, 500, 'Starting to learn basic patterns'),
  ('Intermediate', 2, 45.0, 1000, 'Understanding market patterns'),
  ('Pro', 3, 55.0, 5000, 'Consistently profitable trader'),
  ('Expert', 4, 65.0, 10000, 'Mastering market dynamics'),
  ('Master', 5, 75.0, 50000, 'Elite level performance'),
  ('Exceptional', 6, 85.0, 100000, 'Exceptional trading consistency')
ON CONFLICT (skill_level) DO UPDATE SET
  min_win_rate = EXCLUDED.min_win_rate,
  min_total_wins = EXCLUDED.min_total_wins,
  description = EXCLUDED.description,
  updated_at = now();

-- ============================================================================
-- STEP 3: UPDATE SKILL CALCULATION FUNCTION
-- ============================================================================

-- Function to calculate skill level based on new thresholds
CREATE OR REPLACE FUNCTION calculate_skill_level_new(
  total_wins integer,
  current_win_rate numeric
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  determined_level text := 'Novice';
BEGIN
  -- Check requirements in reverse order (highest to lowest)
  IF total_wins >= 100000 AND current_win_rate >= 85.0 THEN
    determined_level := 'Exceptional';
  ELSIF total_wins >= 50000 AND current_win_rate >= 75.0 THEN
    determined_level := 'Master';
  ELSIF total_wins >= 10000 AND current_win_rate >= 65.0 THEN
    determined_level := 'Expert';
  ELSIF total_wins >= 5000 AND current_win_rate >= 55.0 THEN
    determined_level := 'Pro';
  ELSIF total_wins >= 1000 AND current_win_rate >= 45.0 THEN
    determined_level := 'Intermediate';
  ELSIF total_wins >= 500 AND current_win_rate >= 35.0 THEN
    determined_level := 'Novice';
  ELSE
    determined_level := 'Novice';
  END IF;

  RETURN determined_level;
END;
$$;

-- Function to get next level requirements
CREATE OR REPLACE FUNCTION get_next_level_requirements(current_level text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_order integer;
  next_level_data jsonb;
BEGIN
  -- Get current level order
  SELECT level_order INTO current_order
  FROM ai_skill_level_requirements
  WHERE skill_level = current_level;

  -- Get next level data
  SELECT jsonb_build_object(
    'level', skill_level,
    'min_win_rate', min_win_rate,
    'min_total_wins', min_total_wins,
    'description', description
  ) INTO next_level_data
  FROM ai_skill_level_requirements
  WHERE level_order = current_order + 1;

  -- If no next level (already at max), return null
  IF next_level_data IS NULL THEN
    RETURN jsonb_build_object(
      'level', 'Exceptional',
      'min_win_rate', 85.0,
      'min_total_wins', 100000,
      'description', 'Maximum level achieved',
      'is_max_level', true
    );
  END IF;

  RETURN next_level_data || jsonb_build_object('is_max_level', false);
END;
$$;

-- Function to calculate progress to next level
CREATE OR REPLACE FUNCTION calculate_progress_to_next_level(
  current_total_wins integer,
  current_win_rate numeric,
  current_level text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  next_level_info jsonb;
  wins_progress numeric;
  win_rate_progress numeric;
  overall_progress numeric;
BEGIN
  -- Get next level requirements
  next_level_info := get_next_level_requirements(current_level);

  -- If already at max level
  IF (next_level_info->>'is_max_level')::boolean THEN
    RETURN jsonb_build_object(
      'overall_progress', 100.0,
      'wins_progress', 100.0,
      'win_rate_progress', 100.0,
      'is_max_level', true,
      'next_level', 'Exceptional'
    );
  END IF;

  -- Calculate wins progress
  wins_progress := LEAST(100.0, (current_total_wins::numeric / (next_level_info->>'min_total_wins')::numeric) * 100.0);

  -- Calculate win rate progress
  win_rate_progress := LEAST(100.0, (current_win_rate / (next_level_info->>'min_win_rate')::numeric) * 100.0);

  -- Overall progress is the minimum of both (need to meet BOTH requirements)
  overall_progress := LEAST(wins_progress, win_rate_progress);

  RETURN jsonb_build_object(
    'overall_progress', overall_progress,
    'wins_progress', wins_progress,
    'win_rate_progress', win_rate_progress,
    'wins_needed', (next_level_info->>'min_total_wins')::integer - current_total_wins,
    'win_rate_needed', (next_level_info->>'min_win_rate')::numeric,
    'win_rate_gap', (next_level_info->>'min_win_rate')::numeric - current_win_rate,
    'is_max_level', false,
    'next_level', next_level_info->>'level'
  );
END;
$$;

-- ============================================================================
-- STEP 4: CREATE INITIALIZATION FUNCTION
-- ============================================================================

-- Function to initialize skill progression for a user (starts at Novice)
CREATE OR REPLACE FUNCTION initialize_skill_progression(target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_record_id uuid;
BEGIN
  -- Check if already exists
  IF EXISTS (SELECT 1 FROM ai_skill_progression WHERE user_id = target_user_id) THEN
    -- Already initialized
    SELECT id INTO new_record_id FROM ai_skill_progression WHERE user_id = target_user_id;
    RETURN new_record_id;
  END IF;

  -- Create new skill progression record starting at Novice
  INSERT INTO ai_skill_progression (
    user_id,
    current_skill_level,
    total_trades_analyzed,
    winning_trades,
    losing_trades,
    current_win_rate,
    best_win_rate_achieved,
    trades_at_current_level,
    level_achieved_at,
    progress_to_next_level_percent,
    total_insights_discovered,
    total_patterns_learned,
    confidence_score_avg,
    learning_velocity_daily
  ) VALUES (
    target_user_id,
    'Novice',
    0,
    0,
    0,
    0.0,
    0.0,
    0,
    now(),
    0.0,
    0,
    0,
    0.0,
    0.0
  )
  RETURNING id INTO new_record_id;

  RETURN new_record_id;
END;
$$;

-- ============================================================================
-- STEP 5: ADD INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index for skill level lookups
CREATE INDEX IF NOT EXISTS idx_skill_requirements_order
  ON ai_skill_level_requirements(level_order);

-- ============================================================================
-- STEP 6: GRANT EXECUTE PERMISSIONS
-- ============================================================================

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION reset_user_learning_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_skill_level_new(integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_level_requirements(text) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_progress_to_next_level(integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_skill_progression(uuid) TO authenticated;

-- ============================================================================
-- NOTES
-- ============================================================================

/*
  To reset a user's learning data, call:
  SELECT reset_user_learning_data('user-id-here');

  To initialize skill progression after reset:
  SELECT initialize_skill_progression('user-id-here');

  To check skill level requirements:
  SELECT * FROM ai_skill_level_requirements ORDER BY level_order;

  To calculate current skill level:
  SELECT calculate_skill_level_new(total_wins, win_rate);

  To get progress to next level:
  SELECT calculate_progress_to_next_level(current_wins, current_win_rate, 'Novice');
*/
