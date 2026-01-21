# Phase 3 Section 4: Daily Compliance Scoring - Implementation Plan

**Date:** 2026-01-20
**Status:** 🔨 IN PROGRESS
**Priority:** P1 - Governance Excellence
**Dependencies:** Phase 3.1, 3.2, 3.3 ✅

---

## Executive Summary

**Phase 3.4 Goal:** Transform violation monitoring into actionable compliance metrics

**Current State (After Phase 3.3):**
- ✅ We can SEE violations (dashboard)
- ✅ We can DETECT violations (tests)
- ✅ We are NOTIFIED about violations (alerts)
- ❌ We don't have QUANTIFIED compliance scores
- ❌ We don't have TREND analysis
- ❌ We don't have AUTOMATED reports

**Target State (After Phase 3.4):**
- ✅ Daily compliance score calculation
- ✅ Component-level health scores
- ✅ Historical trend tracking
- ✅ Automated weekly reports
- ✅ Benchmark comparisons
- ✅ Predictive trending

---

## Compliance Scoring Formula

### Platform Compliance Score (0-100)

```
Platform Score = Weighted Average of:
  - Critical Violations (40% weight): max(0, 100 - (critical_count * 10))
  - High Violations (30% weight): max(0, 100 - (high_count * 5))
  - Medium Violations (20% weight): max(0, 100 - (medium_count * 2))
  - Low Violations (10% weight): max(0, 100 - (low_count * 1))

Grade:
  - A+ (95-100): Excellent
  - A (90-94): Very Good
  - B (80-89): Good
  - C (70-79): Fair
  - D (60-69): Poor
  - F (<60): Critical
```

### Component Health Score (0-100)

```
Component Score = max(0, 100 - (violations_count * severity_multiplier))

Severity Multipliers:
  - Critical: 20 points
  - High: 10 points
  - Medium: 5 points
  - Low: 2 points

Status:
  - Healthy (90-100): Green
  - Warning (70-89): Yellow
  - Critical (50-69): Orange
  - Failing (<50): Red
```

### Trend Analysis

```
Trend Direction:
  - Improving: Score increased by >5 points (7 days)
  - Stable: Score changed by ±5 points (7 days)
  - Declining: Score decreased by >5 points (7 days)

Velocity:
  - Current Score - Previous Score
  - Positive = Improving
  - Negative = Declining
```

---

## Database Schema

### 1. Daily Compliance Scores Table

```sql
CREATE TABLE governance_compliance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Date tracking
  score_date DATE NOT NULL UNIQUE,

  -- Platform-wide scores
  platform_score NUMERIC(5,2) NOT NULL CHECK (platform_score >= 0 AND platform_score <= 100),
  platform_grade TEXT NOT NULL CHECK (platform_grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),

  -- Violation counts by severity
  critical_violations INTEGER DEFAULT 0,
  high_violations INTEGER DEFAULT 0,
  medium_violations INTEGER DEFAULT 0,
  low_violations INTEGER DEFAULT 0,
  total_violations INTEGER DEFAULT 0,

  -- Components
  total_components INTEGER DEFAULT 0,
  healthy_components INTEGER DEFAULT 0, -- 90-100
  warning_components INTEGER DEFAULT 0, -- 70-89
  critical_components INTEGER DEFAULT 0, -- 50-69
  failing_components INTEGER DEFAULT 0, -- <50

  -- Trend indicators
  trend_direction TEXT CHECK (trend_direction IN ('improving', 'stable', 'declining')),
  trend_velocity NUMERIC(5,2), -- Points changed from previous period

  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT now(),
  calculation_method TEXT DEFAULT 'automated',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compliance_scores_date ON governance_compliance_scores(score_date DESC);
CREATE INDEX idx_compliance_scores_grade ON governance_compliance_scores(platform_grade);
CREATE INDEX idx_compliance_scores_trend ON governance_compliance_scores(trend_direction);
```

### 2. Component Health Scores Table

```sql
CREATE TABLE governance_component_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Date and component
  score_date DATE NOT NULL,
  component_name TEXT NOT NULL,

  -- Health metrics
  health_score NUMERIC(5,2) NOT NULL CHECK (health_score >= 0 AND health_score <= 100),
  health_status TEXT NOT NULL CHECK (health_status IN ('healthy', 'warning', 'critical', 'failing')),

  -- Violation breakdown
  critical_violations INTEGER DEFAULT 0,
  high_violations INTEGER DEFAULT 0,
  medium_violations INTEGER DEFAULT 0,
  low_violations INTEGER DEFAULT 0,
  total_violations INTEGER DEFAULT 0,

  -- Trend
  trend_direction TEXT CHECK (trend_direction IN ('improving', 'stable', 'declining')),
  previous_score NUMERIC(5,2),
  score_change NUMERIC(5,2),

  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(score_date, component_name)
);

CREATE INDEX idx_component_health_date ON governance_component_health(score_date DESC);
CREATE INDEX idx_component_health_component ON governance_component_health(component_name);
CREATE INDEX idx_component_health_status ON governance_component_health(health_status);
CREATE INDEX idx_component_health_score ON governance_component_health(health_score DESC);
```

### 3. Compliance Reports Table

```sql
CREATE TABLE governance_compliance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Report identification
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly', 'monthly')),
  report_period_start DATE NOT NULL,
  report_period_end DATE NOT NULL,

  -- Summary metrics
  average_score NUMERIC(5,2),
  highest_score NUMERIC(5,2),
  lowest_score NUMERIC(5,2),
  score_range NUMERIC(5,2),

  -- Trend summary
  overall_trend TEXT CHECK (overall_trend IN ('improving', 'stable', 'declining')),
  total_violations INTEGER,
  resolved_violations INTEGER,
  new_violations INTEGER,

  -- Top offenders
  top_violation_types JSONB, -- [{type, count, severity}]
  top_problem_components JSONB, -- [{component, score, violations}]

  -- Recommendations
  critical_actions JSONB, -- [{action, reason, priority}]
  improvement_suggestions JSONB,

  -- Report data
  report_summary TEXT,
  report_details JSONB,

  -- Status
  generated_at TIMESTAMPTZ DEFAULT now(),
  sent_to TEXT[], -- Email recipients
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reports_type ON governance_compliance_reports(report_type);
CREATE INDEX idx_reports_period ON governance_compliance_reports(report_period_start, report_period_end);
CREATE INDEX idx_reports_generated ON governance_compliance_reports(generated_at DESC);
```

---

## Automated Scoring Functions

### 1. Calculate Daily Compliance Score

```sql
CREATE OR REPLACE FUNCTION calculate_daily_compliance_score(p_score_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_trend_direction TEXT;
  v_trend_velocity NUMERIC;
  v_component_counts RECORD;
BEGIN
  -- Get violation counts for the day
  SELECT
    COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
    COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
    COUNT(*) FILTER (WHERE severity = 'medium') AS medium_count,
    COUNT(*) FILTER (WHERE severity = 'low') AS low_count,
    COUNT(*) AS total_count
  INTO v_critical_count, v_high_count, v_medium_count, v_low_count, v_total_count
  FROM ssot_violations
  WHERE DATE(detected_at) = p_score_date;

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
  SELECT platform_score INTO v_previous_score
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
  ELSE
    v_trend_velocity := 0;
    v_trend_direction := 'stable';
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
    trend_velocity
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
    v_trend_velocity
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
    calculated_at = now();
END;
$$;
```

### 2. Calculate Component Health Scores

```sql
CREATE OR REPLACE FUNCTION calculate_component_health_scores(p_score_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_component RECORD;
  v_health_score NUMERIC;
  v_health_status TEXT;
  v_previous_score NUMERIC;
  v_trend_direction TEXT;
  v_score_change NUMERIC;
BEGIN
  -- Calculate health score for each component
  FOR v_component IN
    SELECT
      service_name AS component_name,
      COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
      COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
      COUNT(*) FILTER (WHERE severity = 'medium') AS medium_count,
      COUNT(*) FILTER (WHERE severity = 'low') AS low_count,
      COUNT(*) AS total_count
    FROM ssot_violations
    WHERE DATE(detected_at) = p_score_date
    GROUP BY service_name
  LOOP
    -- Calculate health score
    v_health_score := GREATEST(0, 100 - (
      v_component.critical_count * 20 +
      v_component.high_count * 10 +
      v_component.medium_count * 5 +
      v_component.low_count * 2
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
      v_component.critical_count,
      v_component.high_count,
      v_component.medium_count,
      v_component.low_count,
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
  END LOOP;
END;
$$;
```

### 3. Generate Weekly Report

```sql
CREATE OR REPLACE FUNCTION generate_weekly_compliance_report(
  p_period_start DATE,
  p_period_end DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report_id UUID;
  v_avg_score NUMERIC;
  v_highest_score NUMERIC;
  v_lowest_score NUMERIC;
  v_overall_trend TEXT;
  v_total_violations INTEGER;
  v_top_violations JSONB;
  v_top_components JSONB;
BEGIN
  -- Calculate summary metrics
  SELECT
    AVG(platform_score),
    MAX(platform_score),
    MIN(platform_score)
  INTO v_avg_score, v_highest_score, v_lowest_score
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
  WHERE DATE(detected_at) BETWEEN p_period_start AND p_period_end;

  -- Get top violation types
  SELECT jsonb_agg(row_to_json(t))
  INTO v_top_violations
  FROM (
    SELECT
      violation_type AS type,
      COUNT(*) AS count,
      severity
    FROM ssot_violations
    WHERE DATE(detected_at) BETWEEN p_period_start AND p_period_end
    GROUP BY violation_type, severity
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

  -- Create report
  INSERT INTO governance_compliance_reports (
    report_type,
    report_period_start,
    report_period_end,
    average_score,
    highest_score,
    lowest_score,
    score_range,
    overall_trend,
    total_violations,
    top_violation_types,
    top_problem_components
  ) VALUES (
    'weekly',
    p_period_start,
    p_period_end,
    v_avg_score,
    v_highest_score,
    v_lowest_score,
    v_highest_score - v_lowest_score,
    v_overall_trend,
    v_total_violations,
    v_top_violations,
    v_top_components
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;
```

---

## Automated Scheduling

### Daily Score Calculation (via cron)

```sql
-- Run daily at midnight UTC
-- This would be configured in Supabase cron or via Edge Function

SELECT calculate_component_health_scores(CURRENT_DATE);
SELECT calculate_daily_compliance_score(CURRENT_DATE);
```

### Weekly Report Generation (via cron)

```sql
-- Run weekly on Monday at 6am UTC
-- Generate report for previous week

SELECT generate_weekly_compliance_report(
  CURRENT_DATE - INTERVAL '7 days',
  CURRENT_DATE - INTERVAL '1 day'
);
```

---

## Compliance Dashboard UI

### Features

1. **Overview Card**
   - Current compliance score (large display)
   - Grade badge (A+, A, B, C, D, F)
   - Trend indicator (arrow up/down/stable)
   - 7-day mini sparkline

2. **Trend Chart**
   - 30-day compliance score history
   - Line chart with score markers
   - Grade thresholds overlaid
   - Hover tooltips with details

3. **Component Health Grid**
   - Grid of all components
   - Color-coded by health status
   - Sort by score, name, violations
   - Click to see component details

4. **Violation Breakdown**
   - Pie chart by severity
   - Bar chart by type
   - Trend over time

5. **Reports Section**
   - List of generated reports
   - Download/view options
   - Schedule configuration

---

## Success Metrics

**Phase 3.4 Success Criteria:**
- [ ] Daily scores calculated automatically
- [ ] Component health tracked per day
- [ ] 30-day historical trends available
- [ ] Weekly reports generated
- [ ] Dashboard displays all metrics
- [ ] Scores trigger alerts when thresholds met
- [ ] Zero performance impact on trading
- [ ] Build passes

---

## Implementation Timeline

**Total Estimate:** 6-8 hours

1. **Database Schema** (1 hour)
   - Create 3 tables
   - Create 3 scoring functions
   - Add RLS policies
   - Enable realtime

2. **Scoring Service** (2 hours)
   - TypeScript service wrapper
   - Score calculation logic
   - Trend analysis
   - Report generation

3. **Dashboard UI** (3 hours)
   - Overview card
   - Trend charts
   - Component grid
   - Reports section

4. **Testing & Polish** (1-2 hours)
   - Test calculations
   - Verify trends
   - Generate sample data
   - Deploy

---

## Risk Assessment

**Risk Level:** LOW

**Benefits:**
- Quantified compliance metrics
- Trend visibility
- Automated reporting
- Proactive improvement tracking

**Risks:**
- Score calculations may need tuning
- Historical data limited initially
- Report generation performance

**Mitigation:**
- Configurable score weights
- Bootstrap historical data
- Async report generation

---

Let's begin implementation!
