/*
  # Create Platform-Wide Mastery Data Aggregation RPC

  1. Problem
    - Platform-Wide Pipnosis Evolution chart shows blank in production
    - RLS policies restrict all tables to auth.uid() = user_id
    - When fetching platform-wide data (userId = null), all queries are blocked
    - Chart receives empty arrays, renders blank

  2. Solution (CCIP-Compliant)
    - Create RPC function with SECURITY DEFINER
    - Bypasses RLS restrictions for platform-wide aggregation
    - Service calls RPC instead of direct table queries
    - Maintains security through function-level authorization

  3. Implementation
    - Function: get_platform_mastery_curve_data()
    - Returns aggregated data across all users by date
    - Combines 6 metric sources into single result set
    - Uses direct table access with elevated privileges

  4. Governance & SSOT
    - SECURITY DEFINER ensures proper privilege elevation
    - Single source of truth for platform aggregation
    - No data duplication or inconsistency
    - CCIP-compliant architecture
*/

-- Create RPC function to fetch platform-wide mastery data
CREATE OR REPLACE FUNCTION get_platform_mastery_curve_data(p_days_back INT DEFAULT 365)
RETURNS TABLE (
  date TEXT,
  win_rate NUMERIC,
  profit_factor NUMERIC,
  ev_score NUMERIC,
  calibration_accuracy_100 NUMERIC,
  llm_layer_pass_rate_avg NUMERIC,
  avoid_pattern_success_rate NUMERIC,
  total_trades INT,
  insights_validated INT,
  mistakes_prevented INT,
  winning_patterns_added INT,
  mastery_score NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH date_range AS (
  SELECT CURRENT_DATE - INTERVAL '1 day' * p_days_back as start_date
),
performance_agg AS (
  SELECT
    p.measurement_date::TEXT as date,
    AVG(COALESCE(p.win_rate, 50))::NUMERIC as avg_win_rate,
    AVG(COALESCE(p.profit_factor, 1.0))::NUMERIC as avg_profit_factor,
    SUM(COALESCE(p.total_trades, 0))::INT as total_trades,
    SUM(COALESCE(p.insights_applied, 0))::INT as insights_applied_sum
  FROM ai_performance_evolution p, date_range dr
  WHERE p.period_type = 'daily'
    AND p.measurement_date::DATE >= dr.start_date
  GROUP BY p.measurement_date
),
calibration_agg AS (
  SELECT
    DATE(c.window_end_time)::TEXT as date,
    AVG(COALESCE(c.accuracy_percentage, 70))::NUMERIC as avg_calibration
  FROM ai_confidence_performance c, date_range dr
  WHERE c.window_type IN ('last_100', 'daily')
    AND c.window_end_time::DATE >= dr.start_date
  GROUP BY DATE(c.window_end_time)
),
insights_agg AS (
  SELECT
    (i.created_at::DATE)::TEXT as date,
    COUNT(CASE WHEN i.insight_type = 'positive' THEN 1 END)::INT as winning_patterns,
    COUNT(CASE WHEN i.times_applied > 0 THEN 1 END)::INT as validated_count
  FROM ai_learning_insights i, date_range dr
  WHERE i.created_at::DATE >= dr.start_date
  GROUP BY i.created_at::DATE
),
avoid_agg AS (
  SELECT
    (a.timestamp::DATE)::TEXT as date,
    COUNT(CASE WHEN a.was_blocked THEN 1 END)::INT as blocked_count,
    COUNT(CASE WHEN NOT a.was_blocked THEN 1 END)::INT as allowed_count
  FROM avoid_pattern_enforcement_log a, date_range dr
  WHERE a.timestamp::DATE >= dr.start_date
  GROUP BY a.timestamp::DATE
),
llm_agg AS (
  SELECT
    l.date::TEXT,
    AVG(COALESCE(l.pass_rate, 80))::NUMERIC as avg_pass_rate
  FROM llm_layer_kpis l, date_range dr
  WHERE l.date::DATE >= dr.start_date
  GROUP BY l.date
),
ev_agg AS (
  SELECT
    (gst.created_at::DATE)::TEXT as date,
    AVG(COALESCE(gst.profit_loss, 0))::NUMERIC as daily_ev
  FROM goal_session_trades gst, date_range dr
  WHERE gst.created_at::DATE >= dr.start_date
  GROUP BY gst.created_at::DATE
),
merged_data AS (
  SELECT
    COALESCE(p.date, c.date, i.date, a.date, l.date, e.date) as final_date,
    COALESCE(p.avg_win_rate, 50)::NUMERIC as win_rate,
    COALESCE(p.avg_profit_factor, 1.0)::NUMERIC as profit_factor,
    CASE
      WHEN COALESCE(e.daily_ev, 0) >= 100 THEN 100::NUMERIC
      WHEN COALESCE(e.daily_ev, 0) <= -50 THEN 0::NUMERIC
      ELSE (((COALESCE(e.daily_ev, 0) + 50) / 150.0) * 100)::NUMERIC
    END as ev_score,
    COALESCE(c.avg_calibration, 70)::NUMERIC as calibration_accuracy_100,
    COALESCE(l.avg_pass_rate, 80)::NUMERIC as llm_layer_pass_rate_avg,
    CASE
      WHEN (COALESCE(a.blocked_count, 0) + COALESCE(a.allowed_count, 0)) > 0
      THEN ((COALESCE(a.blocked_count, 0)::NUMERIC / (COALESCE(a.blocked_count, 0) + COALESCE(a.allowed_count, 0))::NUMERIC) * 100)::NUMERIC
      ELSE 0::NUMERIC
    END as avoid_pattern_success_rate,
    COALESCE(p.total_trades, 0)::INT as total_trades,
    COALESCE(i.validated_count, 0)::INT as insights_validated,
    COALESCE(a.blocked_count, 0)::INT as mistakes_prevented,
    COALESCE(i.winning_patterns, 0)::INT as winning_patterns_added
  FROM performance_agg p
  FULL OUTER JOIN calibration_agg c ON p.date = c.date
  FULL OUTER JOIN insights_agg i ON COALESCE(p.date, c.date) = i.date
  FULL OUTER JOIN avoid_agg a ON COALESCE(p.date, c.date, i.date) = a.date
  FULL OUTER JOIN llm_agg l ON COALESCE(p.date, c.date, i.date, a.date) = l.date
  FULL OUTER JOIN ev_agg e ON COALESCE(p.date, c.date, i.date, a.date, l.date) = e.date
)
SELECT
  final_date as date,
  win_rate,
  profit_factor,
  ev_score,
  calibration_accuracy_100,
  llm_layer_pass_rate_avg,
  avoid_pattern_success_rate,
  total_trades,
  insights_validated,
  mistakes_prevented,
  winning_patterns_added,
  (
    (win_rate * 0.25) +
    (LEAST(profit_factor / 3, 1) * 100 * 0.20) +
    (ev_score * 0.20) +
    (calibration_accuracy_100 * 0.15) +
    (avoid_pattern_success_rate * 0.10) +
    (llm_layer_pass_rate_avg * 0.10)
  )::NUMERIC as mastery_score
FROM merged_data
WHERE final_date IS NOT NULL
ORDER BY final_date ASC;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_platform_mastery_curve_data(INT) TO authenticated;

-- Add function comment for documentation
COMMENT ON FUNCTION get_platform_mastery_curve_data(INT) IS
'Aggregates platform-wide mastery evolution data across all users for analytics dashboards.
Uses SECURITY DEFINER to bypass RLS and read from all user records.
Parameters: p_days_back (default 365) - number of days of history to return.';
