/*
  # Create Recommendation Tracking System

  1. New Tables
    - `ai_recommendation_tracker`
      - Tracks individual recommendations from GPT-4o
      - Links recommendations to their implementation status
      - Records timing and success metrics

    - `recommendation_implementation_log`
      - Detailed log of implementation attempts
      - Links to automatic adjustments queue
      - Tracks success/failure reasons

  2. Changes
    - Add status tracking to existing meta learning insights
    - Create views for easy status queries
    - Add indexes for performance

  3. Security
    - Enable RLS on new tables
    - Add policies for authenticated users to read/write their own data
*/

-- Create recommendation tracker table
CREATE TABLE IF NOT EXISTS ai_recommendation_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_learning_insight_id uuid REFERENCES ai_meta_learning_insights(id) ON DELETE CASCADE,
  recommendation_text text NOT NULL,
  recommendation_category text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  expected_impact text,

  -- Status tracking
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'manual_required')),
  implementation_type text, -- 'automatic', 'manual', 'hybrid'

  -- Timing
  recommended_at timestamptz NOT NULL DEFAULT now(),
  implementation_started_at timestamptz,
  implementation_completed_at timestamptz,
  time_to_implement_seconds integer,

  -- Implementation details
  adjustment_queue_ids uuid[] DEFAULT '{}',
  implementation_details jsonb,
  success_metrics jsonb,
  failure_reason text,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create implementation log table
CREATE TABLE IF NOT EXISTS recommendation_implementation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES ai_recommendation_tracker(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Implementation attempt details
  attempt_number integer NOT NULL DEFAULT 1,
  action_type text NOT NULL, -- 'confidence_adjustment', 'pattern_adoption', 'risk_parameter', etc.
  target_name text NOT NULL,
  old_value text,
  new_value text,

  -- Status
  status text NOT NULL CHECK (status IN ('queued', 'applying', 'applied', 'failed', 'rolled_back')),
  error_message text,

  -- Timing
  attempted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- Links to other systems
  adjustment_queue_id uuid,
  related_pattern_id uuid,

  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_recommendation_tracker_user_status
  ON ai_recommendation_tracker(user_id, status);

CREATE INDEX IF NOT EXISTS idx_recommendation_tracker_insight
  ON ai_recommendation_tracker(meta_learning_insight_id);

CREATE INDEX IF NOT EXISTS idx_recommendation_tracker_recommended_at
  ON ai_recommendation_tracker(recommended_at DESC);

CREATE INDEX IF NOT EXISTS idx_implementation_log_recommendation
  ON recommendation_implementation_log(recommendation_id);

CREATE INDEX IF NOT EXISTS idx_implementation_log_user
  ON recommendation_implementation_log(user_id, attempted_at DESC);

-- Create view for dashboard display
CREATE OR REPLACE VIEW ai_recommendations_with_status AS
SELECT
  r.*,
  i.high_level_interpretation,
  i.analysis_type,
  COUNT(l.id) as implementation_attempt_count,
  MAX(l.completed_at) as last_implementation_attempt,
  jsonb_agg(
    jsonb_build_object(
      'action_type', l.action_type,
      'target_name', l.target_name,
      'status', l.status,
      'attempted_at', l.attempted_at
    ) ORDER BY l.attempted_at DESC
  ) FILTER (WHERE l.id IS NOT NULL) as implementation_history
FROM ai_recommendation_tracker r
LEFT JOIN ai_meta_learning_insights i ON i.id = r.meta_learning_insight_id
LEFT JOIN recommendation_implementation_log l ON l.recommendation_id = r.id
GROUP BY r.id, i.high_level_interpretation, i.analysis_type;

-- Enable Row Level Security
ALTER TABLE ai_recommendation_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_implementation_log ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies

-- ai_recommendation_tracker policies
CREATE POLICY "Users can view own recommendations"
  ON ai_recommendation_tracker FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recommendations"
  ON ai_recommendation_tracker FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recommendations"
  ON ai_recommendation_tracker FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- recommendation_implementation_log policies
CREATE POLICY "Users can view own implementation logs"
  ON recommendation_implementation_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own implementation logs"
  ON recommendation_implementation_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own implementation logs"
  ON recommendation_implementation_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_recommendation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_recommendation_tracker_updated_at
  BEFORE UPDATE ON ai_recommendation_tracker
  FOR EACH ROW
  EXECUTE FUNCTION update_recommendation_updated_at();

-- Create function to calculate time to implement
CREATE OR REPLACE FUNCTION calculate_time_to_implement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.implementation_completed_at IS NOT NULL AND NEW.recommended_at IS NOT NULL THEN
    NEW.time_to_implement_seconds = EXTRACT(EPOCH FROM (NEW.implementation_completed_at - NEW.recommended_at))::integer;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_recommendation_time
  BEFORE UPDATE ON ai_recommendation_tracker
  FOR EACH ROW
  WHEN (NEW.implementation_completed_at IS NOT NULL AND OLD.implementation_completed_at IS NULL)
  EXECUTE FUNCTION calculate_time_to_implement();

-- Create function to get recommendation implementation summary
CREATE OR REPLACE FUNCTION get_recommendation_summary(p_user_id uuid, p_days integer DEFAULT 7)
RETURNS TABLE (
  total_recommendations bigint,
  completed_recommendations bigint,
  in_progress_recommendations bigint,
  pending_recommendations bigint,
  failed_recommendations bigint,
  avg_time_to_implement_seconds numeric,
  success_rate numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_recommendations,
    COUNT(*) FILTER (WHERE status = 'completed')::bigint as completed_recommendations,
    COUNT(*) FILTER (WHERE status = 'in_progress')::bigint as in_progress_recommendations,
    COUNT(*) FILTER (WHERE status = 'pending')::bigint as pending_recommendations,
    COUNT(*) FILTER (WHERE status = 'failed')::bigint as failed_recommendations,
    AVG(time_to_implement_seconds) as avg_time_to_implement_seconds,
    CASE
      WHEN COUNT(*) > 0 THEN
        (COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*)::numeric * 100)
      ELSE 0
    END as success_rate
  FROM ai_recommendation_tracker
  WHERE user_id = p_user_id
    AND recommended_at >= now() - (p_days || ' days')::interval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE ai_recommendation_tracker IS 'Tracks GPT-4o recommendations and their implementation status';
COMMENT ON TABLE recommendation_implementation_log IS 'Detailed log of recommendation implementation attempts';
COMMENT ON VIEW ai_recommendations_with_status IS 'Consolidated view of recommendations with implementation history';
