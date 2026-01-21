/*
  # Create Governance Compliance Scoring System (Fixed Column References)

  1. Overview
     - Daily automated compliance score calculations
     - Component-level health tracking
     - Historical trend analysis
     - Automated weekly/monthly reporting
     - Predictive compliance metrics

  2. New Tables
     - `governance_compliance_scores` - Daily platform scores
     - `governance_component_health` - Component health tracking
     - `governance_compliance_reports` - Weekly/monthly reports

  3. Functions
     - `calculate_daily_compliance_score(date)` - Calculate platform score
     - `calculate_component_health_scores(date)` - Calculate component scores
     - `generate_weekly_compliance_report(start, end)` - Generate reports
     - `get_compliance_trend(days)` - Get trend data
     - `get_component_health_summary()` - Get current health

  4. Column Mapping for ssot_violations
     - Using `call_location` as component identifier
     - Using `violation_type` for violation categorization
     - Using `created_at` for time-based queries
     - NOTE: severity column may not exist, will map from violation_type instead
*/

-- =====================================================
-- 1. Daily Compliance Scores Table
-- =====================================================

CREATE TABLE IF NOT EXISTS governance_compliance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_date DATE NOT NULL UNIQUE,
  platform_score NUMERIC(5,2) NOT NULL CHECK (platform_score >= 0 AND platform_score <= 100),
  platform_grade TEXT NOT NULL CHECK (platform_grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
  critical_violations INTEGER DEFAULT 0 CHECK (critical_violations >= 0),
  high_violations INTEGER DEFAULT 0 CHECK (high_violations >= 0),
  medium_violations INTEGER DEFAULT 0 CHECK (medium_violations >= 0),
  low_violations INTEGER DEFAULT 0 CHECK (low_violations >= 0),
  total_violations INTEGER DEFAULT 0 CHECK (total_violations >= 0),
  total_components INTEGER DEFAULT 0 CHECK (total_components >= 0),
  healthy_components INTEGER DEFAULT 0 CHECK (healthy_components >= 0),
  warning_components INTEGER DEFAULT 0 CHECK (warning_components >= 0),
  critical_components INTEGER DEFAULT 0 CHECK (critical_components >= 0),
  failing_components INTEGER DEFAULT 0 CHECK (failing_components >= 0),
  trend_direction TEXT CHECK (trend_direction IN ('improving', 'stable', 'declining')),
  trend_velocity NUMERIC(5,2),
  days_at_current_grade INTEGER DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT now(),
  calculation_method TEXT DEFAULT 'automated',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_scores_date ON governance_compliance_scores(score_date DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_scores_grade ON governance_compliance_scores(platform_grade);
CREATE INDEX IF NOT EXISTS idx_compliance_scores_trend ON governance_compliance_scores(trend_direction);
CREATE INDEX IF NOT EXISTS idx_compliance_scores_score ON governance_compliance_scores(platform_score DESC);

-- =====================================================
-- 2. Component Health Scores Table
-- =====================================================

CREATE TABLE IF NOT EXISTS governance_component_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_date DATE NOT NULL,
  component_name TEXT NOT NULL,
  health_score NUMERIC(5,2) NOT NULL CHECK (health_score >= 0 AND health_score <= 100),
  health_status TEXT NOT NULL CHECK (health_status IN ('healthy', 'warning', 'critical', 'failing')),
  critical_violations INTEGER DEFAULT 0 CHECK (critical_violations >= 0),
  high_violations INTEGER DEFAULT 0 CHECK (high_violations >= 0),
  medium_violations INTEGER DEFAULT 0 CHECK (medium_violations >= 0),
  low_violations INTEGER DEFAULT 0 CHECK (low_violations >= 0),
  total_violations INTEGER DEFAULT 0 CHECK (total_violations >= 0),
  trend_direction TEXT CHECK (trend_direction IN ('improving', 'stable', 'declining')),
  previous_score NUMERIC(5,2),
  score_change NUMERIC(5,2),
  calculated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(score_date, component_name)
);

CREATE INDEX IF NOT EXISTS idx_component_health_date ON governance_component_health(score_date DESC);
CREATE INDEX IF NOT EXISTS idx_component_health_component ON governance_component_health(component_name);
CREATE INDEX IF NOT EXISTS idx_component_health_status ON governance_component_health(health_status);
CREATE INDEX IF NOT EXISTS idx_component_health_score ON governance_component_health(health_score DESC);
CREATE INDEX IF NOT EXISTS idx_component_health_date_component ON governance_component_health(score_date, component_name);

-- =====================================================
-- 3. Compliance Reports Table
-- =====================================================

CREATE TABLE IF NOT EXISTS governance_compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly', 'monthly')),
  report_period_start DATE NOT NULL,
  report_period_end DATE NOT NULL,
  average_score NUMERIC(5,2),
  highest_score NUMERIC(5,2),
  lowest_score NUMERIC(5,2),
  score_range NUMERIC(5,2),
  score_std_dev NUMERIC(5,2),
  overall_trend TEXT CHECK (overall_trend IN ('improving', 'stable', 'declining')),
  total_violations INTEGER DEFAULT 0,
  resolved_violations INTEGER DEFAULT 0,
  new_violations INTEGER DEFAULT 0,
  top_violation_types JSONB DEFAULT '[]'::jsonb,
  top_problem_components JSONB DEFAULT '[]'::jsonb,
  most_improved_components JSONB DEFAULT '[]'::jsonb,
  critical_actions JSONB DEFAULT '[]'::jsonb,
  improvement_suggestions JSONB DEFAULT '[]'::jsonb,
  report_summary TEXT,
  report_details JSONB DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ DEFAULT now(),
  sent_to TEXT[],
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_type ON governance_compliance_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_reports_period ON governance_compliance_reports(report_period_start, report_period_end);
CREATE INDEX IF NOT EXISTS idx_reports_generated ON governance_compliance_reports(generated_at DESC);

-- =====================================================
-- 4. RLS Policies
-- =====================================================

ALTER TABLE governance_compliance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_component_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_compliance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read compliance scores"
  ON governance_compliance_scores FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins can read component health"
  ON governance_component_health FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Admins can read reports"
  ON governance_compliance_reports FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role can manage compliance scores"
  ON governance_compliance_scores FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage component health"
  ON governance_component_health FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage reports"
  ON governance_compliance_reports FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 5. Scoring Functions
-- =====================================================

-- Function: Calculate Component Health Scores
-- Uses call_location as component identifier
CREATE OR REPLACE FUNCTION calculate_component_health_scores(p_score_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_component RECORD;
  v_health_score NUMERIC;
  v_health_status TEXT;
  v_previous_score NUMERIC;
  v_trend_direction TEXT;
  v_score_change NUMERIC;
  v_components_processed INTEGER := 0;
  v_critical_count INTEGER;
  v_high_count INTEGER;
  v_medium_count INTEGER;
  v_low_count INTEGER;
BEGIN
  -- Calculate health score for each component (using call_location as component name)
  FOR v_component IN
    SELECT
      call_location AS component_name,
      COUNT(*) AS total_count
    FROM ssot_violations
    WHERE DATE(created_at) = p_score_date
    GROUP BY call_location
  LOOP
    -- Classify violations by type (simple heuristic based on violation_type)
    -- Critical: execution, validation, corruption
    -- High: bypass, data access, inconsistency
    -- Medium: other types
    -- Low: warnings
    
    SELECT
      COUNT(*) FILTER (WHERE violation_type ILIKE '%execution%' OR violation_type ILIKE '%validation%' OR violation_type ILIKE '%corruption%'),
      COUNT(*) FILTER (WHERE violation_type ILIKE '%bypass%' OR violation_type ILIKE '%access%' OR violation_type ILIKE '%inconsistent%'),
      COUNT(*) FILTER (WHERE violation_type NOT ILIKE '%execution%' AND violation_type NOT ILIKE '%validation%' AND violation_type NOT ILIKE '%corruption%' AND violation_type NOT ILIKE '%bypass%' AND violation_type NOT ILIKE '%access%' AND violation_type NOT ILIKE '%inconsistent%'),
      0
    INTO v_critical_count, v_high_count, v_medium_count, v_low_count
    FROM ssot_violations
    WHERE DATE(created_at) = p_score_date
    AND call_location = v_component.component_name;
    
    -- Calculate health score
    v_health_score := GREATEST(0, 100 - (
      v_critical_count * 20 +
      v_high_count * 10 +
      v_medium_count * 5 +
      v_low_count * 2
    ));

    -- Determine status
    v_health_status := CASE
      WHEN v_health_score >= 90 THEN 'healthy'
      WHEN v_health_score >= 70 THEN 'warning'
      WHEN v_health_score >= 50 THEN 'critical'
      ELSE 'failing'
    END;

    -- Get previous score
    SELECT health_score INTO v_previous_score
    FROM governance_component_health
    WHERE component_name = v_component.component_name
    AND score_date < p_score_date
    ORDER BY score_date DESC
    LIMIT 1;

    -- Calculate trend
    IF v_previous_score IS NOT NULL THEN
      v_score_change := v_health_score - v_previous_score;
      v_trend_direction := CASE
        WHEN v_score_change > 5 THEN 'improving'
        WHEN v_score_change < -5 THEN 'declining'
        ELSE 'stable'
      END;
    ELSE
      v_score_change := 0;
      v_trend_direction := 'stable';
    END IF;

    -- Insert component health
    INSERT INTO governance_component_health (
      score_date,
      component_name,
      health_score,
      health_status,
      critical_violations,
      high_violations,
      medium_violations,
      low_violations,
      total_violations,
      trend_direction,
      previous_score,
      score_change
    ) VALUES (
      p_score_date,
      v_component.component_name,
      v_health_score,
      v_health_status,
      v_critical_count,
      v_high_count,
      v_medium_count,
      v_low_count,
      v_component.total_count,
      v_trend_direction,
      v_previous_score,
      v_score_change
    )
    ON CONFLICT (score_date, component_name) DO UPDATE SET
      health_score = EXCLUDED.health_score,
      health_status = EXCLUDED.health_status,
      critical_violations = EXCLUDED.critical_violations,
      high_violations = EXCLUDED.high_violations,
      medium_violations = EXCLUDED.medium_violations,
      low_violations = EXCLUDED.low_violations,
      total_violations = EXCLUDED.total_violations,
      trend_direction = EXCLUDED.trend_direction,
      previous_score = EXCLUDED.previous_score,
      score_change = EXCLUDED.score_change,
      calculated_at = now();

    v_components_processed := v_components_processed + 1;
  END LOOP;

  RETURN v_components_processed;
END;
$$;

-- Function: Calculate Daily Compliance Score
CREATE OR REPLACE FUNCTION calculate_daily_compliance_score(p_score_date DATE DEFAULT CURRENT_DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_critical_count INTEGER;
  v_high_count INTEGER;
  v_medium_count INTEGER;
  v_low_count INTEGER;
  v_total_count INTEGER;
  v_platform_score NUMERIC;
  v_platform_grade TEXT;
  v_previous_score NUMERIC;
  v_previous_grade TEXT;
  v_trend_direction TEXT;
  v_trend_velocity NUMERIC;
  v_days_at_grade INTEGER;
  v_component_counts RECORD;
  v_result_id UUID;
BEGIN
  -- First calculate component health scores
  PERFORM calculate_component_health_scores(p_score_date);

  -- Get violation counts for the day (classify by type)
  SELECT
    COUNT(*) FILTER (WHERE violation_type ILIKE '%execution%' OR violation_type ILIKE '%validation%' OR violation_type ILIKE '%corruption%'),
    COUNT(*) FILTER (WHERE violation_type ILIKE '%bypass%' OR violation_type ILIKE '%access%' OR violation_type ILIKE '%inconsistent%'),
    COUNT(*) FILTER (WHERE violation_type NOT ILIKE '%execution%' AND violation_type NOT ILIKE '%validation%' AND violation_type NOT ILIKE '%corruption%' AND violation_type NOT ILIKE '%bypass%' AND violation_type NOT ILIKE '%access%' AND violation_type NOT ILIKE '%inconsistent%'),
    0,
    COUNT(*)
  INTO v_critical_count, v_high_count, v_medium_count, v_low_count, v_total_count
  FROM ssot_violations
  WHERE DATE(created_at) = p_score_date;

  -- Calculate weighted platform score
  v_platform_score := (
    GREATEST(0, 100 - (v_critical_count * 10)) * 0.4 +
    GREATEST(0, 100 - (v_high_count * 5)) * 0.3 +
    GREATEST(0, 100 - (v_medium_count * 2)) * 0.2 +
    GREATEST(0, 100 - (v_low_count * 1)) * 0.1
  );

  -- Determine grade
  v_platform_grade := CASE
    WHEN v_platform_score >= 95 THEN 'A+'
    WHEN v_platform_score >= 90 THEN 'A'
    WHEN v_platform_score >= 80 THEN 'B'
    WHEN v_platform_score >= 70 THEN 'C'
    WHEN v_platform_score >= 60 THEN 'D'
    ELSE 'F'
  END;

  -- Get previous score for trend
  SELECT platform_score, platform_grade, days_at_current_grade
  INTO v_previous_score, v_previous_grade, v_days_at_grade
  FROM governance_compliance_scores
  WHERE score_date < p_score_date
  ORDER BY score_date DESC
  LIMIT 1;

  -- Calculate trend
  IF v_previous_score IS NOT NULL THEN
    v_trend_velocity := v_platform_score - v_previous_score;
    v_trend_direction := CASE
      WHEN v_trend_velocity > 5 THEN 'improving'
      WHEN v_trend_velocity < -5 THEN 'declining'
      ELSE 'stable'
    END;
    
    IF v_platform_grade = v_previous_grade THEN
      v_days_at_grade := COALESCE(v_days_at_grade, 0) + 1;
    ELSE
      v_days_at_grade := 1;
    END IF;
  ELSE
    v_trend_velocity := 0;
    v_trend_direction := 'stable';
    v_days_at_grade := 1;
  END IF;

  -- Get component health counts
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE health_score >= 90) AS healthy,
    COUNT(*) FILTER (WHERE health_score >= 70 AND health_score < 90) AS warning,
    COUNT(*) FILTER (WHERE health_score >= 50 AND health_score < 70) AS critical,
    COUNT(*) FILTER (WHERE health_score < 50) AS failing
  INTO v_component_counts
  FROM governance_component_health
  WHERE score_date = p_score_date;

  -- Insert or update compliance score
  INSERT INTO governance_compliance_scores (
    score_date,
    platform_score,
    platform_grade,
    critical_violations,
    high_violations,
    medium_violations,
    low_violations,
    total_violations,
    total_components,
    healthy_components,
    warning_components,
    critical_components,
    failing_components,
    trend_direction,
    trend_velocity,
    days_at_current_grade
  ) VALUES (
    p_score_date,
    v_platform_score,
    v_platform_grade,
    v_critical_count,
    v_high_count,
    v_medium_count,
    v_low_count,
    v_total_count,
    COALESCE(v_component_counts.total, 0),
    COALESCE(v_component_counts.healthy, 0),
    COALESCE(v_component_counts.warning, 0),
    COALESCE(v_component_counts.critical, 0),
    COALESCE(v_component_counts.failing, 0),
    v_trend_direction,
    v_trend_velocity,
    v_days_at_grade
  )
  ON CONFLICT (score_date) DO UPDATE SET
    platform_score = EXCLUDED.platform_score,
    platform_grade = EXCLUDED.platform_grade,
    critical_violations = EXCLUDED.critical_violations,
    high_violations = EXCLUDED.high_violations,
    medium_violations = EXCLUDED.medium_violations,
    low_violations = EXCLUDED.low_violations,
    total_violations = EXCLUDED.total_violations,
    total_components = EXCLUDED.total_components,
    healthy_components = EXCLUDED.healthy_components,
    warning_components = EXCLUDED.warning_components,
    critical_components = EXCLUDED.critical_components,
    failing_components = EXCLUDED.failing_components,
    trend_direction = EXCLUDED.trend_direction,
    trend_velocity = EXCLUDED.trend_velocity,
    days_at_current_grade = EXCLUDED.days_at_current_grade,
    calculated_at = now()
  RETURNING id INTO v_result_id;

  RETURN v_result_id;
END;
$$;

-- Function: Get Compliance Trend Data
CREATE OR REPLACE FUNCTION get_compliance_trend(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  score_date DATE,
  platform_score NUMERIC,
  platform_grade TEXT,
  total_violations INTEGER,
  trend_direction TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gcs.score_date,
    gcs.platform_score,
    gcs.platform_grade,
    gcs.total_violations,
    gcs.trend_direction
  FROM governance_compliance_scores gcs
  WHERE gcs.score_date >= CURRENT_DATE - p_days
  ORDER BY gcs.score_date ASC;
END;
$$;

-- Function: Get Component Health Summary
CREATE OR REPLACE FUNCTION get_component_health_summary()
RETURNS TABLE (
  component_name TEXT,
  current_health_score NUMERIC,
  health_status TEXT,
  total_violations INTEGER,
  trend_direction TEXT,
  score_change NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gch.component_name,
    gch.health_score AS current_health_score,
    gch.health_status,
    gch.total_violations,
    gch.trend_direction,
    gch.score_change
  FROM governance_component_health gch
  WHERE gch.score_date = (
    SELECT MAX(score_date)
    FROM governance_component_health
  )
  ORDER BY gch.health_score ASC;
END;
$$;

-- Function: Generate Weekly Report
CREATE OR REPLACE FUNCTION generate_weekly_compliance_report(
  p_period_start DATE DEFAULT CURRENT_DATE - INTERVAL '7 days',
  p_period_end DATE DEFAULT CURRENT_DATE - INTERVAL '1 day'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id UUID;
  v_avg_score NUMERIC;
  v_highest_score NUMERIC;
  v_lowest_score NUMERIC;
  v_std_dev NUMERIC;
  v_overall_trend TEXT;
  v_total_violations INTEGER;
  v_top_violations JSONB;
  v_top_components JSONB;
  v_improved_components JSONB;
BEGIN
  -- Calculate summary metrics
  SELECT
    AVG(platform_score)::NUMERIC(5,2),
    MAX(platform_score),
    MIN(platform_score),
    STDDEV(platform_score)::NUMERIC(5,2)
  INTO v_avg_score, v_highest_score, v_lowest_score, v_std_dev
  FROM governance_compliance_scores
  WHERE score_date BETWEEN p_period_start AND p_period_end;

  -- Determine overall trend
  WITH trend_calc AS (
    SELECT
      FIRST_VALUE(platform_score) OVER (ORDER BY score_date) AS first_score,
      LAST_VALUE(platform_score) OVER (ORDER BY score_date ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_score
    FROM governance_compliance_scores
    WHERE score_date BETWEEN p_period_start AND p_period_end
  )
  SELECT
    CASE
      WHEN last_score - first_score > 5 THEN 'improving'
      WHEN last_score - first_score < -5 THEN 'declining'
      ELSE 'stable'
    END
  INTO v_overall_trend
  FROM trend_calc
  LIMIT 1;

  -- Get total violations
  SELECT COUNT(*) INTO v_total_violations
  FROM ssot_violations
  WHERE DATE(created_at) BETWEEN p_period_start AND p_period_end;

  -- Get top violation types
  SELECT jsonb_agg(row_to_json(t))
  INTO v_top_violations
  FROM (
    SELECT
      violation_type AS type,
      COUNT(*) AS count
    FROM ssot_violations
    WHERE DATE(created_at) BETWEEN p_period_start AND p_period_end
    GROUP BY violation_type
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t;

  -- Get top problem components
  SELECT jsonb_agg(row_to_json(c))
  INTO v_top_components
  FROM (
    SELECT
      component_name,
      AVG(health_score)::NUMERIC(5,2) AS avg_score,
      SUM(total_violations) AS total_violations
    FROM governance_component_health
    WHERE score_date BETWEEN p_period_start AND p_period_end
    GROUP BY component_name
    ORDER BY AVG(health_score) ASC
    LIMIT 10
  ) c;

  -- Get most improved components
  SELECT jsonb_agg(row_to_json(i))
  INTO v_improved_components
  FROM (
    SELECT
      component_name,
      AVG(score_change)::NUMERIC(5,2) AS avg_improvement
    FROM governance_component_health
    WHERE score_date BETWEEN p_period_start AND p_period_end
    AND score_change > 0
    GROUP BY component_name
    ORDER BY AVG(score_change) DESC
    LIMIT 5
  ) i;

  -- Create report
  INSERT INTO governance_compliance_reports (
    report_type,
    report_period_start,
    report_period_end,
    average_score,
    highest_score,
    lowest_score,
    score_range,
    score_std_dev,
    overall_trend,
    total_violations,
    top_violation_types,
    top_problem_components,
    most_improved_components
  ) VALUES (
    'weekly',
    p_period_start,
    p_period_end,
    v_avg_score,
    v_highest_score,
    v_lowest_score,
    v_highest_score - v_lowest_score,
    v_std_dev,
    v_overall_trend,
    v_total_violations,
    COALESCE(v_top_violations, '[]'::jsonb),
    COALESCE(v_top_components, '[]'::jsonb),
    COALESCE(v_improved_components, '[]'::jsonb)
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- =====================================================
-- 6. Realtime Enablement
-- =====================================================

ALTER PUBLICATION supabase_realtime ADD TABLE governance_compliance_scores;
ALTER PUBLICATION supabase_realtime ADD TABLE governance_component_health;

-- =====================================================
-- 7. Comments
-- =====================================================

COMMENT ON TABLE governance_compliance_scores IS 'Daily platform-wide compliance scores with trend tracking';
COMMENT ON TABLE governance_component_health IS 'Component-level health scores with historical trends';
COMMENT ON TABLE governance_compliance_reports IS 'Weekly and monthly compliance reports with recommendations';

COMMENT ON FUNCTION calculate_component_health_scores(DATE) IS 'Calculate health scores for all components for a given date';
COMMENT ON FUNCTION calculate_daily_compliance_score(DATE) IS 'Calculate platform-wide compliance score for a given date';
COMMENT ON FUNCTION get_compliance_trend(INTEGER) IS 'Get compliance score trend data for charting';
COMMENT ON FUNCTION get_component_health_summary() IS 'Get current component health summary';
COMMENT ON FUNCTION generate_weekly_compliance_report(DATE, DATE) IS 'Generate weekly compliance report with analysis';

-- =====================================================
-- 8. Bootstrap Current Day Score
-- =====================================================

-- Calculate scores for today to populate initial data
SELECT calculate_daily_compliance_score(CURRENT_DATE);
