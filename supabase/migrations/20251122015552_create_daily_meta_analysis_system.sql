/*
  # Create Daily Meta-Analysis System

  ## Overview
  Replaces weekly meta-analysis with DAILY strategic learning that compares today vs yesterday.
  The AI now learns after EVERY session (30x per month) instead of once per week.

  Daily meta-analysis feeds into tomorrow's LLM pair selection for continuous improvement.

  ## Changes
  1. Create `daily_meta_analysis` table - Strategic insights generated daily
  2. Deprecate `weekly_meta_analyses` table - No longer used
  3. Add RLS policies for daily meta-analysis
  4. Create indexes for performance
  5. Add helper functions for trend analysis

  ## Security
  - RLS enabled for user isolation
  - Authenticated users can only access their own analysis
*/

-- ============================================================================
-- TABLE 1: Daily Meta Analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_meta_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,

  -- Performance Comparison (Today vs Yesterday)
  today_win_rate numeric NOT NULL,
  yesterday_win_rate numeric,
  win_rate_delta numeric,
  performance_trend text NOT NULL, -- 'improving', 'declining', 'stable'

  today_profit_factor numeric NOT NULL,
  yesterday_profit_factor numeric,
  profit_factor_delta numeric,

  today_total_trades integer NOT NULL,
  yesterday_total_trades integer,

  -- Strategic Insights
  strategic_recommendations text[] NOT NULL DEFAULT '{}',
  patterns_to_emphasize text[] NOT NULL DEFAULT '{}',
  patterns_to_avoid text[] NOT NULL DEFAULT '{}',

  -- Confidence Calibration
  confidence_calibration jsonb NOT NULL DEFAULT '{
    "current_accuracy": 70,
    "recommended_threshold": 75,
    "adjustment_reasoning": "",
    "overconfident_sessions": 0,
    "underconfident_sessions": 0
  }'::jsonb,

  -- Pair Recommendations for Tomorrow
  recommended_pairs jsonb NOT NULL DEFAULT '[]'::jsonb,
  pairs_to_avoid text[] NOT NULL DEFAULT '{}',

  -- Learning Insights
  key_discoveries text[] NOT NULL DEFAULT '{}',
  improvement_focus text[] NOT NULL DEFAULT '{}',
  estimated_improvement_potential text,

  -- Metadata
  analysis_quality_score integer DEFAULT 85,
  generated_by text DEFAULT 'daily_meta_analyzer',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, date)
);

-- ============================================================================
-- DEPRECATE Weekly Meta Analyses Table
-- ============================================================================

COMMENT ON TABLE weekly_meta_analyses IS
'DEPRECATED: Replaced by daily_meta_analysis table. Weekly analysis has been converted to daily strategic learning. This table is kept for historical data only and will be removed in a future migration.';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_daily_meta_analysis_user_date
ON daily_meta_analysis(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_meta_analysis_trend
ON daily_meta_analysis(user_id, performance_trend)
WHERE performance_trend IN ('improving', 'declining');

CREATE INDEX IF NOT EXISTS idx_daily_meta_analysis_recent
ON daily_meta_analysis(user_id, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE daily_meta_analysis ENABLE ROW LEVEL SECURITY;

-- Users can view their own daily meta-analysis
CREATE POLICY "Users can view own daily meta-analysis"
  ON daily_meta_analysis FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create their own daily meta-analysis
CREATE POLICY "Users can create own daily meta-analysis"
  ON daily_meta_analysis FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own daily meta-analysis
CREATE POLICY "Users can update own daily meta-analysis"
  ON daily_meta_analysis FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get yesterday's meta-analysis for comparison and pair selection
CREATE OR REPLACE FUNCTION get_yesterday_meta_analysis(p_user_id uuid)
RETURNS TABLE(
  date date,
  strategic_recommendations text[],
  patterns_to_emphasize text[],
  patterns_to_avoid text[],
  confidence_calibration jsonb,
  recommended_pairs jsonb,
  pairs_to_avoid text[],
  performance_trend text,
  win_rate_delta numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dma.date,
    dma.strategic_recommendations,
    dma.patterns_to_emphasize,
    dma.patterns_to_avoid,
    dma.confidence_calibration,
    dma.recommended_pairs,
    dma.pairs_to_avoid,
    dma.performance_trend,
    dma.win_rate_delta
  FROM daily_meta_analysis dma
  WHERE dma.user_id = p_user_id
    AND dma.date = CURRENT_DATE - INTERVAL '1 day'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get last N days of meta-analysis for trend analysis
CREATE OR REPLACE FUNCTION get_recent_meta_analyses(p_user_id uuid, p_days integer DEFAULT 7)
RETURNS TABLE(
  date date,
  performance_trend text,
  today_win_rate numeric,
  win_rate_delta numeric,
  strategic_recommendations text[],
  patterns_to_emphasize text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dma.date,
    dma.performance_trend,
    dma.today_win_rate,
    dma.win_rate_delta,
    dma.strategic_recommendations,
    dma.patterns_to_emphasize
  FROM daily_meta_analysis dma
  WHERE dma.user_id = p_user_id
    AND dma.date >= CURRENT_DATE - (p_days || ' days')::interval
  ORDER BY dma.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Calculate performance streak (consecutive improving/declining days)
CREATE OR REPLACE FUNCTION get_performance_streak(p_user_id uuid)
RETURNS TABLE(
  streak_type text,
  streak_length integer,
  avg_win_rate_delta numeric
) AS $$
DECLARE
  v_current_trend text;
  v_streak_count integer := 0;
  v_sum_delta numeric := 0;
  v_count integer := 0;
BEGIN
  -- Get most recent trend
  SELECT performance_trend INTO v_current_trend
  FROM daily_meta_analysis
  WHERE user_id = p_user_id
  ORDER BY date DESC
  LIMIT 1;

  -- Count consecutive days with same trend
  SELECT COUNT(*), AVG(win_rate_delta)
  INTO v_streak_count, v_sum_delta
  FROM (
    SELECT
      performance_trend,
      win_rate_delta,
      date,
      ROW_NUMBER() OVER (ORDER BY date DESC) as rn
    FROM daily_meta_analysis
    WHERE user_id = p_user_id
      AND date >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY date DESC
  ) sub
  WHERE performance_trend = v_current_trend
    AND rn = (
      SELECT MIN(rn2)
      FROM (
        SELECT ROW_NUMBER() OVER (ORDER BY date DESC) as rn2
        FROM daily_meta_analysis
        WHERE user_id = p_user_id
          AND date >= CURRENT_DATE - INTERVAL '30 days'
          AND performance_trend != v_current_trend
      ) sub2
    );

  RETURN QUERY
  SELECT
    COALESCE(v_current_trend, 'stable')::text,
    COALESCE(v_streak_count, 0)::integer,
    COALESCE(v_sum_delta, 0)::numeric;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE daily_meta_analysis IS
'Daily strategic meta-analysis comparing today vs yesterday performance. Generated after every session (30x per month). Feeds into tomorrow''s LLM pair selection for continuous learning.';

COMMENT ON COLUMN daily_meta_analysis.performance_trend IS
'Trend direction: improving (today better than yesterday), declining (today worse), stable (similar performance)';

COMMENT ON COLUMN daily_meta_analysis.recommended_pairs IS
'JSON array of pairs recommended for tomorrow based on today''s performance and patterns';

COMMENT ON COLUMN daily_meta_analysis.confidence_calibration IS
'JSON object with calibration metrics: current_accuracy, recommended_threshold, adjustment_reasoning, over/underconfident session counts';

COMMENT ON FUNCTION get_yesterday_meta_analysis IS
'Returns yesterday''s meta-analysis for use in today''s pair selection and strategy adjustments';

COMMENT ON FUNCTION get_recent_meta_analyses IS
'Returns last N days of meta-analyses for trend analysis and pattern identification';

COMMENT ON FUNCTION get_performance_streak IS
'Calculates current performance streak (consecutive improving/declining days) and average win rate delta';
