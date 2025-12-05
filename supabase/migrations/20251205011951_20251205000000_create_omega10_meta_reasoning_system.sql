/*
  # Omega-10 Meta-Reasoning System

  Creates the database infrastructure for Omega-10, the highest-ranking specialist
  that oversees the entire Omega Council and Alpha Brain.

  ## Purpose

  Enables system-level intelligence that:
  - Detects contradictions between Alpha and Omegas
  - Identifies pattern drift and recurring failures
  - Analyzes confidence calibration
  - Predicts risk horizons
  - Recommends strategic adjustments
  - Maintains long-term system memory

  ## Tables Created

  1. **omega10_analysis** - Stores each meta-reasoning analysis
  2. **omega10_intervention_log** - Tracks active interventions and adjustments
  3. **omega10_system_health** - Rolling window of system health metrics

  ## How It Works

  1. Omega-10 runs periodically (every 4-8 hours) or when triggered by anomalies
  2. Analyzes recent Alpha decisions, Omega votes, and trade outcomes
  3. Detects system-level issues and generates recommendations
  4. Updates strategy memory and applies weight overrides
  5. Logs all findings for tracking and learning
*/

-- ============================================================================
-- Omega-10 Analysis Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS omega10_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Analysis Context
  timestamp timestamptz DEFAULT now() NOT NULL,
  analysis_type text NOT NULL CHECK (analysis_type IN ('scheduled', 'triggered', 'manual')),
  trigger_reason text,

  -- Findings (JSONB for flexibility)
  contradictions jsonb DEFAULT '[]'::jsonb,
  drift_warnings jsonb DEFAULT '[]'::jsonb,
  confidence_issues jsonb DEFAULT '[]'::jsonb,

  -- Risk Assessment
  risk_horizon text NOT NULL CHECK (risk_horizon IN ('low', 'medium', 'high')),
  risk_reasons jsonb DEFAULT '[]'::jsonb,
  risk_recommended_actions jsonb DEFAULT '[]'::jsonb,

  -- Recommendations
  strategy_adjustments jsonb DEFAULT '[]'::jsonb,
  omega_weight_overrides jsonb DEFAULT '{}'::jsonb,
  recommended_strategy_mode text,

  -- Memory Update
  memory_update jsonb,

  -- Meta Information
  used_llm boolean DEFAULT false,
  llm_reasoning text,
  llm_tokens_used integer,
  meta_confidence integer NOT NULL CHECK (meta_confidence >= 0 AND meta_confidence <= 100),

  -- Scheduling
  next_review_at timestamptz NOT NULL,
  completed_at timestamptz DEFAULT now(),

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- Omega-10 Intervention Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS omega10_intervention_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  omega10_analysis_id uuid REFERENCES omega10_analysis(id) ON DELETE CASCADE,

  -- Intervention Details
  intervention_type text NOT NULL CHECK (
    intervention_type IN (
      'weight_override',
      'strategy_change',
      'risk_reduction',
      'pattern_avoidance',
      'confidence_adjustment'
    )
  ),
  target text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),

  -- Lifecycle
  active_from timestamptz DEFAULT now() NOT NULL,
  active_until timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'reverted')),

  -- Effectiveness Tracking
  pre_performance jsonb,
  post_performance jsonb,
  effectiveness_score numeric,

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- Omega-10 System Health Metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS omega10_system_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Time Window
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,

  -- System Metrics
  total_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_confidence numeric DEFAULT 0,
  confidence_variance numeric DEFAULT 0,

  -- Issue Counts
  contradictions_detected integer DEFAULT 0,
  drift_warnings_raised integer DEFAULT 0,
  confidence_issues_found integer DEFAULT 0,

  -- Intervention Stats
  interventions_applied integer DEFAULT 0,
  interventions_successful integer DEFAULT 0,

  -- Risk Assessment
  avg_risk_level numeric DEFAULT 0,
  high_risk_periods integer DEFAULT 0,

  -- Overall Health Score (0-100)
  health_score integer NOT NULL CHECK (health_score >= 0 AND health_score <= 100),

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Recent analyses by user
CREATE INDEX IF NOT EXISTS idx_omega10_analysis_user_recent
ON omega10_analysis(user_id, timestamp DESC);

-- Active interventions
CREATE INDEX IF NOT EXISTS idx_omega10_interventions_active
ON omega10_intervention_log(user_id, status, active_until)
WHERE status = 'active';

-- Next review scheduling
CREATE INDEX IF NOT EXISTS idx_omega10_analysis_next_review
ON omega10_analysis(user_id, next_review_at);

-- System health tracking
CREATE INDEX IF NOT EXISTS idx_omega10_health_user_window
ON omega10_system_health(user_id, window_end DESC);

-- Intervention effectiveness analysis
CREATE INDEX IF NOT EXISTS idx_omega10_interventions_effectiveness
ON omega10_intervention_log(user_id, intervention_type, effectiveness_score DESC)
WHERE effectiveness_score IS NOT NULL;

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE omega10_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE omega10_intervention_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE omega10_system_health ENABLE ROW LEVEL SECURITY;

-- Users can read their own analyses
CREATE POLICY "Users can read own omega10 analyses"
  ON omega10_analysis
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own analyses
CREATE POLICY "Users can insert own omega10 analyses"
  ON omega10_analysis
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access to analyses
CREATE POLICY "Service role full access to omega10 analyses"
  ON omega10_analysis
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own interventions
CREATE POLICY "Users can read own omega10 interventions"
  ON omega10_intervention_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own interventions
CREATE POLICY "Users can insert own omega10 interventions"
  ON omega10_intervention_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own interventions
CREATE POLICY "Users can update own omega10 interventions"
  ON omega10_intervention_log
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access to interventions
CREATE POLICY "Service role full access to omega10 interventions"
  ON omega10_intervention_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own system health
CREATE POLICY "Users can read own omega10 health"
  ON omega10_system_health
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access to system health
CREATE POLICY "Service role full access to omega10 health"
  ON omega10_system_health
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to expire old interventions
CREATE OR REPLACE FUNCTION expire_omega10_interventions()
RETURNS void AS $$
BEGIN
  UPDATE omega10_intervention_log
  SET status = 'expired'
  WHERE status = 'active'
    AND active_until IS NOT NULL
    AND active_until < now();
END;
$$ LANGUAGE plpgsql;

-- Function to get active interventions for a user
CREATE OR REPLACE FUNCTION get_active_omega10_interventions(p_user_id uuid)
RETURNS TABLE (
  intervention_type text,
  target text,
  action text,
  priority text,
  active_from timestamptz
) AS $$
BEGIN
  -- Expire old interventions first
  PERFORM expire_omega10_interventions();

  RETURN QUERY
  SELECT
    il.intervention_type,
    il.target,
    il.action,
    il.priority,
    il.active_from
  FROM omega10_intervention_log il
  WHERE il.user_id = p_user_id
    AND il.status = 'active'
    AND (il.active_until IS NULL OR il.active_until > now())
  ORDER BY il.priority DESC, il.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate system health score
CREATE OR REPLACE FUNCTION calculate_omega10_health_score(
  p_user_id uuid,
  p_window_hours integer DEFAULT 24
)
RETURNS integer AS $$
DECLARE
  v_health_score integer;
  v_win_rate numeric;
  v_contradictions integer;
  v_drift_warnings integer;
  v_risk_level text;
BEGIN
  -- Get recent metrics
  SELECT
    COALESCE(AVG(CASE WHEN th.pnl > 0 THEN 1.0 ELSE 0.0 END), 0),
    COUNT(DISTINCT oa.id) FILTER (WHERE jsonb_array_length(oa.contradictions) > 0),
    COUNT(DISTINCT oa.id) FILTER (WHERE jsonb_array_length(oa.drift_warnings) > 0),
    COALESCE(oa.risk_horizon, 'low')
  INTO v_win_rate, v_contradictions, v_drift_warnings, v_risk_level
  FROM trade_history th
  LEFT JOIN omega10_analysis oa ON oa.user_id = th.user_id
    AND oa.timestamp >= now() - (p_window_hours || ' hours')::interval
  WHERE th.user_id = p_user_id
    AND th.exit_time >= now() - (p_window_hours || ' hours')::interval;

  -- Calculate base score from win rate
  v_health_score := ROUND(v_win_rate * 100);

  -- Penalize for contradictions
  v_health_score := v_health_score - (v_contradictions * 5);

  -- Penalize for drift warnings
  v_health_score := v_health_score - (v_drift_warnings * 3);

  -- Penalize for high risk
  IF v_risk_level = 'high' THEN
    v_health_score := v_health_score - 15;
  ELSIF v_risk_level = 'medium' THEN
    v_health_score := v_health_score - 5;
  END IF;

  -- Clamp to 0-100
  v_health_score := GREATEST(0, LEAST(100, v_health_score));

  RETURN v_health_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update intervention timestamp on modification
CREATE OR REPLACE FUNCTION update_omega10_intervention_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_omega10_intervention_timestamp
  BEFORE UPDATE ON omega10_intervention_log
  FOR EACH ROW
  EXECUTE FUNCTION update_omega10_intervention_timestamp();

-- ============================================================================
-- Views
-- ============================================================================

-- View: Recent System Issues
CREATE OR REPLACE VIEW omega10_recent_issues AS
SELECT
  oa.user_id,
  oa.timestamp,
  oa.analysis_type,
  jsonb_array_length(oa.contradictions) as contradiction_count,
  jsonb_array_length(oa.drift_warnings) as drift_warning_count,
  jsonb_array_length(oa.confidence_issues) as confidence_issue_count,
  oa.risk_horizon,
  oa.meta_confidence
FROM omega10_analysis oa
WHERE oa.timestamp >= now() - interval '7 days'
ORDER BY oa.timestamp DESC;

-- View: Intervention Effectiveness
CREATE OR REPLACE VIEW omega10_intervention_effectiveness AS
SELECT
  il.user_id,
  il.intervention_type,
  COUNT(*) as times_applied,
  AVG(il.effectiveness_score) as avg_effectiveness,
  COUNT(*) FILTER (WHERE il.status = 'completed') as completed_count,
  COUNT(*) FILTER (WHERE il.status = 'reverted') as reverted_count
FROM omega10_intervention_log il
WHERE il.created_at >= now() - interval '30 days'
GROUP BY il.user_id, il.intervention_type;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE omega10_analysis IS
'Omega-10 meta-reasoning analyses - System-level intelligence that oversees Alpha and all Omegas';

COMMENT ON TABLE omega10_intervention_log IS
'Active and historical interventions applied by Omega-10 to adjust trading behavior';

COMMENT ON TABLE omega10_system_health IS
'Rolling window metrics tracking overall system health and performance';

COMMENT ON COLUMN omega10_analysis.contradictions IS
'Array of contradictions detected between Alpha and Omega specialists';

COMMENT ON COLUMN omega10_analysis.drift_warnings IS
'Array of pattern drift warnings (losing streaks, SL clustering, regime mismatches)';

COMMENT ON COLUMN omega10_analysis.omega_weight_overrides IS
'Temporary weight multipliers for specific Omega specialists';

COMMENT ON COLUMN omega10_analysis.meta_confidence IS
'Omega-10 confidence in its own analysis (0-100)';

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Omega-10 Meta-Reasoning System Created';
  RAISE NOTICE '   - System-level intelligence enabled';
  RAISE NOTICE '   - Contradiction detection active';
  RAISE NOTICE '   - Pattern drift monitoring online';
  RAISE NOTICE '   - Risk horizon prediction ready';
  RAISE NOTICE '   - Strategic adjustment system deployed';
  RAISE NOTICE '';
  RAISE NOTICE '🧠 Pipnosis Alpha now has OMEGA-LEVEL INTELLIGENCE!';
  RAISE NOTICE '   The system can now think about its own thinking.';
END $$;
