/*
  # 100-Session Milestone GPT-4o Analysis System

  ## Overview
  This migration creates a system to track completed backtest sessions and trigger
  GPT-4o meta-analysis after every 100 sessions. This provides strategic insights
  based on larger datasets compared to single-session analysis.

  ## New Tables

  ### 1. user_session_counters
  Tracks the cumulative count of completed backtest sessions per user
  - Increments on each session completion
  - Triggers batch analysis when count reaches 100, 200, 300, etc.
  - Stores last milestone analyzed

  ### 2. session_milestone_log
  Records each time a 100-session milestone is reached and analyzed
  - Tracks which 100 sessions were included in each batch
  - Links to the GPT-4o meta-learning insights generated
  - Stores batch performance summary

  ### 3. batch_meta_learning_insights
  Stores strategic insights from 100-session batch analyses
  - High-level strategic recommendations based on 100 sessions
  - Pattern adjustments and rule changes
  - Applied to all future sessions until next milestone

  ## Important Features
  - Automatic session counting on completion
  - Milestone detection and GPT-4o trigger
  - Batch aggregation of 100-session data
  - Strategic recommendation tracking
  - Progress monitoring toward next milestone
*/

-- ============================================================================
-- 1. User Session Counters Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_session_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Session counting
  total_sessions_completed integer DEFAULT 0,
  last_session_completed_at timestamptz,

  -- Milestone tracking
  last_milestone_reached integer DEFAULT 0, -- e.g., 0, 100, 200, 300
  last_milestone_analyzed_at timestamptz,
  sessions_since_last_milestone integer DEFAULT 0,

  -- Next milestone
  next_milestone_at integer DEFAULT 100,
  progress_percentage decimal(5,2) DEFAULT 0,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_counters_user_id ON user_session_counters(user_id);
CREATE INDEX IF NOT EXISTS idx_session_counters_milestone ON user_session_counters(sessions_since_last_milestone);

-- Enable RLS
ALTER TABLE user_session_counters ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own session counter"
  ON user_session_counters
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can manage session counters"
  ON user_session_counters
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 2. Session Milestone Log Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_milestone_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Milestone details
  milestone_number integer NOT NULL, -- 100, 200, 300, etc.
  sessions_included_start integer NOT NULL,
  sessions_included_end integer NOT NULL,

  -- Batch performance summary
  total_sessions_analyzed integer NOT NULL,
  total_trades_in_batch integer DEFAULT 0,
  batch_win_rate decimal(5,2),
  batch_profit_factor decimal(10,2),
  batch_total_pnl decimal(10,2),
  batch_avg_css decimal(5,2),

  -- Session list
  session_ids uuid[],

  -- Analysis status
  analysis_status text DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'analyzing', 'completed', 'failed')),
  gpt4o_analysis_started_at timestamptz,
  gpt4o_analysis_completed_at timestamptz,
  gpt4o_insight_id uuid, -- Links to ai_meta_learning_insights or batch_meta_learning_insights

  -- Token usage
  gpt4o_tokens_used integer,
  gpt4o_cost_usd decimal(10,6),

  -- Error tracking
  error_message text,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_milestone_log_user_id ON session_milestone_log(user_id);
CREATE INDEX IF NOT EXISTS idx_milestone_log_milestone ON session_milestone_log(milestone_number DESC);
CREATE INDEX IF NOT EXISTS idx_milestone_log_status ON session_milestone_log(analysis_status);
CREATE INDEX IF NOT EXISTS idx_milestone_log_created ON session_milestone_log(created_at DESC);

-- Enable RLS
ALTER TABLE session_milestone_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own milestone logs"
  ON session_milestone_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can manage milestone logs"
  ON session_milestone_log
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. Batch Meta-Learning Insights Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS batch_meta_learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Link to milestone
  milestone_log_id uuid REFERENCES session_milestone_log(id) ON DELETE CASCADE,
  milestone_number integer NOT NULL,

  -- Batch summary analyzed by GPT-4o
  batch_summary jsonb NOT NULL,

  -- GPT-4o Strategic Analysis
  high_level_interpretation text NOT NULL,
  strategic_recommendations jsonb NOT NULL,
  long_term_trends_detected text[],
  regime_changes_detected jsonb,

  -- Pattern management (across 100 sessions)
  patterns_to_emphasize text[],
  patterns_to_deweight text[],
  patterns_to_ignore text[],

  -- Strategy adjustments
  global_strategy_adjustments jsonb,
  confidence_threshold_adjustments jsonb,
  risk_parameter_adjustments jsonb,

  -- New rule ideas (to test in next 100 sessions)
  new_rule_ideas jsonb,

  -- Priority actions
  next_100_sessions_priorities text[],

  -- Application tracking
  applied_to_sessions boolean DEFAULT false,
  applied_at timestamptz,
  effectiveness_score decimal(5,2), -- Measured after next 100 sessions

  -- GPT-4o metadata
  gpt4o_model text DEFAULT 'gpt-4o',
  tokens_used integer,
  processing_time_ms integer,
  confidence_score decimal(5,2),

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_batch_insights_user_id ON batch_meta_learning_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_insights_milestone ON batch_meta_learning_insights(milestone_number DESC);
CREATE INDEX IF NOT EXISTS idx_batch_insights_log_id ON batch_meta_learning_insights(milestone_log_id);
CREATE INDEX IF NOT EXISTS idx_batch_insights_applied ON batch_meta_learning_insights(applied_to_sessions);
CREATE INDEX IF NOT EXISTS idx_batch_insights_created ON batch_meta_learning_insights(created_at DESC);

-- Enable RLS
ALTER TABLE batch_meta_learning_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own batch insights"
  ON batch_meta_learning_insights
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can manage batch insights"
  ON batch_meta_learning_insights
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. Functions for Session Counter Management
-- ============================================================================

-- Function to initialize counter for new user
CREATE OR REPLACE FUNCTION initialize_session_counter(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_session_counters (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- Function to increment session counter
CREATE OR REPLACE FUNCTION increment_session_counter(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter RECORD;
  v_milestone_reached boolean := false;
  v_milestone_number integer;
BEGIN
  -- Ensure counter exists
  PERFORM initialize_session_counter(p_user_id);

  -- Increment counter
  UPDATE user_session_counters
  SET
    total_sessions_completed = total_sessions_completed + 1,
    sessions_since_last_milestone = sessions_since_last_milestone + 1,
    last_session_completed_at = now(),
    progress_percentage = ((sessions_since_last_milestone + 1)::decimal / 100) * 100,
    updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_counter;

  -- Check if milestone reached
  IF v_counter.sessions_since_last_milestone >= 100 THEN
    v_milestone_reached := true;
    v_milestone_number := v_counter.last_milestone_reached + 100;

    RAISE NOTICE '[Session Counter] 🎉 Milestone reached! User % completed % sessions',
      p_user_id, v_milestone_number;
  END IF;

  RETURN jsonb_build_object(
    'total_sessions', v_counter.total_sessions_completed,
    'sessions_since_milestone', v_counter.sessions_since_last_milestone,
    'milestone_reached', v_milestone_reached,
    'milestone_number', v_milestone_number,
    'next_milestone_at', v_counter.next_milestone_at,
    'progress_percentage', v_counter.progress_percentage
  );
END;
$$;

-- Function to reset counter after milestone analysis
CREATE OR REPLACE FUNCTION reset_milestone_counter(p_user_id uuid, p_milestone_number integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_session_counters
  SET
    last_milestone_reached = p_milestone_number,
    last_milestone_analyzed_at = now(),
    sessions_since_last_milestone = 0,
    next_milestone_at = p_milestone_number + 100,
    progress_percentage = 0,
    updated_at = now()
  WHERE user_id = p_user_id;

  RAISE NOTICE '[Session Counter] Counter reset for user %. Next milestone: %',
    p_user_id, p_milestone_number + 100;
END;
$$;

-- ============================================================================
-- 5. Trigger to Increment Counter on Session Completion
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_session_counter_increment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter_result jsonb;
BEGIN
  -- Only increment when session transitions to completed
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    RAISE NOTICE '[Session Counter] Session % completed, incrementing counter', NEW.id;

    -- Increment counter
    v_counter_result := increment_session_counter(NEW.user_id);

    -- If milestone reached, create milestone log entry
    IF (v_counter_result->>'milestone_reached')::boolean THEN
      RAISE NOTICE '[Session Counter] Creating milestone log for milestone %',
        v_counter_result->>'milestone_number';

      -- Create milestone log (will be processed by batch analysis service)
      INSERT INTO session_milestone_log (
        user_id,
        milestone_number,
        sessions_included_start,
        sessions_included_end,
        total_sessions_analyzed,
        analysis_status
      ) VALUES (
        NEW.user_id,
        (v_counter_result->>'milestone_number')::integer,
        (v_counter_result->>'milestone_number')::integer - 99,
        (v_counter_result->>'milestone_number')::integer,
        100,
        'pending'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS session_counter_increment_trigger ON synthetic_backtest_sessions;
CREATE TRIGGER session_counter_increment_trigger
  AFTER UPDATE ON synthetic_backtest_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_session_counter_increment();

-- ============================================================================
-- 6. Helper Functions
-- ============================================================================

-- Get current session counter status for user
CREATE OR REPLACE FUNCTION get_session_counter_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter RECORD;
BEGIN
  SELECT * INTO v_counter
  FROM user_session_counters
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'total_sessions', 0,
      'sessions_since_milestone', 0,
      'next_milestone_at', 100,
      'progress_percentage', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'total_sessions', v_counter.total_sessions_completed,
    'sessions_since_milestone', v_counter.sessions_since_last_milestone,
    'last_milestone', v_counter.last_milestone_reached,
    'next_milestone_at', v_counter.next_milestone_at,
    'progress_percentage', v_counter.progress_percentage,
    'last_session_at', v_counter.last_session_completed_at,
    'last_milestone_analyzed_at', v_counter.last_milestone_analyzed_at
  );
END;
$$;

-- Get pending milestone analysis jobs
CREATE OR REPLACE FUNCTION get_pending_milestone_analyses()
RETURNS TABLE (
  log_id uuid,
  user_id uuid,
  milestone_number integer,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    id,
    session_milestone_log.user_id,
    milestone_number,
    session_milestone_log.created_at
  FROM session_milestone_log
  WHERE analysis_status = 'pending'
  ORDER BY created_at ASC
  LIMIT 10;
END;
$$;

-- ============================================================================
-- 7. Updated Timestamp Trigger
-- ============================================================================

CREATE TRIGGER update_session_counters_updated_at
  BEFORE UPDATE ON user_session_counters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_milestone_log_updated_at
  BEFORE UPDATE ON session_milestone_log
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_insights_updated_at
  BEFORE UPDATE ON batch_meta_learning_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE user_session_counters IS
  'Tracks cumulative completed backtest sessions per user and triggers GPT-4o analysis at 100-session milestones';

COMMENT ON TABLE session_milestone_log IS
  'Records each 100-session milestone and tracks GPT-4o batch analysis status';

COMMENT ON TABLE batch_meta_learning_insights IS
  'Stores GPT-4o strategic insights from 100-session batch analyses, applied to future sessions';

COMMENT ON FUNCTION increment_session_counter(uuid) IS
  'Increments session counter and detects when 100-session milestone is reached';

COMMENT ON FUNCTION get_session_counter_status(uuid) IS
  'Returns current session counter status including progress toward next milestone';
