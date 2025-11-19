/*
  # Phase 2: Advanced Market Intelligence System

  ## Overview
  Creates tables for market regime classification, confidence calibration,
  and anti-correlation tracking.

  ## New Tables
  1. regime_performance_tracking
  2. regime_optimized_parameters
  3. confidence_updates
  4. confidence_calibration_analysis
  5. correlated_loss_patterns
  6. anti_patterns
  7. dynamic_avoid_list
*/

-- ============================================================================
-- TABLE 1: Regime Performance Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS regime_performance_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  regime text NOT NULL,
  trades_count integer DEFAULT 0,
  wins_count integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  optimal_confidence_threshold integer DEFAULT 75,
  created_at timestamptz DEFAULT now(),
  last_updated timestamptz DEFAULT now(),
  UNIQUE(user_id, symbol, regime)
);

-- ============================================================================
-- TABLE 2: Regime Optimized Parameters
-- ============================================================================

CREATE TABLE IF NOT EXISTS regime_optimized_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  regime_type text NOT NULL,
  confidence_threshold integer NOT NULL,
  position_size_multiplier numeric NOT NULL,
  stop_loss_multiplier numeric NOT NULL,
  take_profit_multiplier numeric NOT NULL,
  max_trades_per_session integer NOT NULL,
  avoid_hours integer[] DEFAULT '{}',
  prefer_hours integer[] DEFAULT '{}',
  reasoning text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, symbol, regime_type)
);

-- ============================================================================
-- TABLE 3: Confidence Updates
-- ============================================================================

CREATE TABLE IF NOT EXISTS confidence_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  prior_confidence numeric NOT NULL,
  posterior_confidence numeric NOT NULL,
  actual_outcome text NOT NULL,
  pattern_name text,
  evidence_strength numeric NOT NULL,
  update_reason text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 4: Confidence Calibration Analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS confidence_calibration_analysis (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  calibration_buckets jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_trades integer DEFAULT 0,
  avg_calibration_error numeric DEFAULT 0,
  analysis_date timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, symbol)
);

-- ============================================================================
-- TABLE 5: Correlated Loss Patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS correlated_loss_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbols text[] NOT NULL,
  correlation_strength numeric NOT NULL,
  loss_frequency numeric NOT NULL,
  avg_loss_amount numeric NOT NULL,
  occurrences integer NOT NULL,
  last_occurrence timestamptz NOT NULL,
  should_avoid boolean DEFAULT false,
  avoidance_reason text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, symbols)
);

-- ============================================================================
-- TABLE 6: Anti-Patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS anti_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,
  description text NOT NULL,
  failure_rate numeric NOT NULL,
  avg_loss numeric NOT NULL,
  occurrences integer NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  avoid_when text[] DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, pattern_type, description)
);

-- ============================================================================
-- TABLE 7: Dynamic Avoid List
-- ============================================================================

CREATE TABLE IF NOT EXISTS dynamic_avoid_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  occurrences integer DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_regime_performance_user_symbol ON regime_performance_tracking(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_regime_optimized_params_user ON regime_optimized_parameters(user_id, symbol, regime_type);
CREATE INDEX IF NOT EXISTS idx_confidence_updates_user ON confidence_updates(user_id, symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correlated_loss_user ON correlated_loss_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_user ON anti_patterns(user_id, failure_rate DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_avoid_list_active ON dynamic_avoid_list(user_id, is_active) WHERE is_active = true;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE regime_performance_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE regime_optimized_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_calibration_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlated_loss_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE anti_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_avoid_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own regime performance" ON regime_performance_tracking FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own regime parameters" ON regime_optimized_parameters FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own confidence updates" ON confidence_updates FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own calibration" ON confidence_calibration_analysis FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own correlations" ON correlated_loss_patterns FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own anti-patterns" ON anti_patterns FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own avoid list" ON dynamic_avoid_list FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
