/*
  # Enable Daily Learning System Architecture

  ## Purpose
  Add columns and tables to support daily learning cycles instead of 10-day batch learning.
  Every single day now includes: pair selection, backtest, LLM analysis, and memory updates.

  ## Changes
  1. Add daily learning metadata to daily_session_results
  2. Create daily_learning_insights table for per-day LLM analysis
  3. Add daily metrics tracking
  4. Add pair selection to daily results

  ## Security
  - Enable RLS on all new tables
  - Users can only access their own learning data
*/

-- Add daily learning fields to daily_session_results
ALTER TABLE daily_session_results
ADD COLUMN IF NOT EXISTS selected_pair text,
ADD COLUMN IF NOT EXISTS pair_confidence numeric,
ADD COLUMN IF NOT EXISTS learning_generated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS patterns_discovered integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS patterns_degraded integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS confidence_adjustments integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS avoid_patterns_enforced integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS llm_analysis_complete boolean DEFAULT false;

COMMENT ON COLUMN daily_session_results.selected_pair IS
'The pair selected by LLM for this daily session';

COMMENT ON COLUMN daily_session_results.pair_confidence IS
'LLM confidence in the selected pair (0-100)';

COMMENT ON COLUMN daily_session_results.learning_generated IS
'Whether LLM post-session analysis was completed';

COMMENT ON COLUMN daily_session_results.patterns_discovered IS
'Number of new patterns discovered during this session';

COMMENT ON COLUMN daily_session_results.patterns_degraded IS
'Number of patterns that degraded/became avoid patterns';

COMMENT ON COLUMN daily_session_results.confidence_adjustments IS
'Number of confidence calibration adjustments made';

-- Create daily_learning_insights table for detailed per-day analysis
CREATE TABLE IF NOT EXISTS daily_learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number >= 1 AND day_number <= 30),
  month_number integer NOT NULL CHECK (month_number > 0),
  session_date timestamptz NOT NULL DEFAULT now(),
  selected_pair text NOT NULL,
  
  -- LLM Analysis Results
  strengths text[] DEFAULT ARRAY[]::text[],
  weaknesses text[] DEFAULT ARRAY[]::text[],
  hidden_patterns jsonb DEFAULT '[]'::jsonb,
  patterns_discovered jsonb DEFAULT '[]'::jsonb,
  avoid_patterns jsonb DEFAULT '[]'::jsonb,
  
  -- Confidence & Performance
  confidence_calibration jsonb DEFAULT '{}'::jsonb,
  expected_vs_actual jsonb DEFAULT '{}'::jsonb,
  
  -- Strategic Recommendations
  recommendations text[] DEFAULT ARRAY[]::text[],
  next_focus_areas text[] DEFAULT ARRAY[]::text[],
  improvement_potential text,
  
  -- Session Metrics
  session_win_rate numeric DEFAULT 0,
  session_ev numeric DEFAULT 0,
  session_pf numeric DEFAULT 0,
  session_css numeric DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_learning_insights_unique
  ON daily_learning_insights(user_id, month_number, day_number);

-- Add indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_learning_user_date
  ON daily_learning_insights(user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_learning_pair
  ON daily_learning_insights(user_id, selected_pair, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_learning_month
  ON daily_learning_insights(user_id, month_number, day_number);

-- Add helpful comments
COMMENT ON TABLE daily_learning_insights IS
'Stores detailed LLM analysis and learnings for each daily trading session';

COMMENT ON COLUMN daily_learning_insights.hidden_patterns IS
'Deep patterns discovered by LLM that werent obvious in initial analysis';

COMMENT ON COLUMN daily_learning_insights.confidence_calibration IS
'Calibration adjustments: {overconfident: [], underconfident: [], well_calibrated: []}';

COMMENT ON COLUMN daily_learning_insights.expected_vs_actual IS
'Comparison of expected confidence vs actual performance for accuracy tracking';

-- Enable Row Level Security
ALTER TABLE daily_learning_insights ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own daily learning
CREATE POLICY "Users view own daily learning"
  ON daily_learning_insights
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own daily learning
CREATE POLICY "Users insert own daily learning"
  ON daily_learning_insights
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own daily learning
CREATE POLICY "Users update own daily learning"
  ON daily_learning_insights
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create function to get 7-day rolling metrics
CREATE OR REPLACE FUNCTION get_7_day_rolling_metrics(
  p_user_id uuid
)
RETURNS TABLE (
  avg_win_rate numeric,
  avg_ev numeric,
  avg_pf numeric,
  avg_css numeric,
  total_patterns_discovered integer,
  total_patterns_degraded integer,
  most_selected_pair text,
  pair_selection_accuracy numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    AVG(dsr.win_rate) as avg_win_rate,
    AVG(dsr.session_ev) as avg_ev,
    AVG(dsr.profit_factor) as avg_pf,
    AVG(dsr.session_css) as avg_css,
    SUM(dsr.patterns_discovered)::integer as total_patterns_discovered,
    SUM(dsr.patterns_degraded)::integer as total_patterns_degraded,
    MODE() WITHIN GROUP (ORDER BY dsr.selected_pair) as most_selected_pair,
    AVG(
      CASE 
        WHEN dsr.pair_confidence IS NOT NULL AND dsr.win_rate IS NOT NULL
        THEN 100 - ABS(dsr.pair_confidence - dsr.win_rate)
        ELSE NULL
      END
    ) as pair_selection_accuracy
  FROM daily_session_results dsr
  WHERE dsr.user_id = p_user_id
    AND dsr.session_date >= NOW() - interval '7 days'
    AND dsr.total_trades > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_7_day_rolling_metrics(uuid) TO authenticated;

COMMENT ON FUNCTION get_7_day_rolling_metrics IS
'Calculates 7-day rolling window metrics for daily learning dashboard';

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_daily_learning_insights_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_daily_learning_insights_timestamp ON daily_learning_insights;
CREATE TRIGGER trigger_update_daily_learning_insights_timestamp
  BEFORE UPDATE ON daily_learning_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_learning_insights_timestamp();
