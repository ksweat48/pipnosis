/*
  # Create AI Confidence Prediction Accuracy Tracking System

  ## Purpose
  Track how well the AI's confidence predictions match actual trade outcomes.
  Measure prediction accuracy and calibration over time.

  ## Tables Created
  1. ai_confidence_calibration - Per-trade confidence accuracy tracking
  2. ai_confidence_performance - Rolling window performance metrics
  3. ai_confidence_history - Historical snapshots for trend analysis

  ## Security
  - Enable RLS on all tables
  - Users can only access their own confidence data
  - Service role has full access for calculations

  ## Key Metrics Tracked
  - Prediction accuracy (did confidence match outcome?)
  - Calibration score (how well predicted probability matches actual win rate)
  - Confidence error rate (difference between predicted and actual)
  - Rolling 10-trade window performance
  - Improvement trends over time
*/

-- ============================================================================
-- STEP 1: Create ai_confidence_calibration table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_confidence_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Trade reference
  trade_id uuid NOT NULL,
  trade_source text NOT NULL CHECK (trade_source IN ('synthetic', 'live', 'backtest')),
  session_id uuid,

  -- Confidence prediction
  predicted_confidence integer NOT NULL CHECK (predicted_confidence >= 0 AND predicted_confidence <= 100),
  confidence_bucket text NOT NULL, -- '0-20', '20-40', '40-60', '60-80', '80-100'

  -- Actual outcome
  actual_outcome text NOT NULL CHECK (actual_outcome IN ('win', 'loss', 'breakeven')),
  pnl numeric,

  -- Accuracy metrics
  was_accurate boolean NOT NULL, -- Did high confidence = win and low confidence = loss?
  confidence_error numeric, -- Absolute difference between predicted and actual
  calibration_score numeric, -- How close prediction was to reality (0-100)

  -- Trade details for analysis
  symbol text NOT NULL,
  timeframe text,
  entry_time timestamptz NOT NULL,
  exit_time timestamptz,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 2: Create ai_confidence_performance table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_confidence_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Window definition
  window_type text NOT NULL CHECK (window_type IN ('last_10', 'last_30', 'last_100', 'session', 'daily', 'all_time')),
  window_start_time timestamptz,
  window_end_time timestamptz,

  -- Accuracy metrics
  total_trades integer DEFAULT 0,
  accurate_predictions integer DEFAULT 0,
  inaccurate_predictions integer DEFAULT 0,
  accuracy_percentage numeric DEFAULT 0,

  -- Calibration metrics
  overall_calibration_score numeric DEFAULT 0,
  calibration_by_bucket jsonb DEFAULT '{}'::jsonb, -- {"0-20": 0.85, "20-40": 0.78, ...}

  -- Error metrics
  average_confidence_error numeric DEFAULT 0,
  max_confidence_error numeric DEFAULT 0,
  min_confidence_error numeric DEFAULT 0,

  -- Trend indicators
  is_improving boolean DEFAULT false,
  improvement_rate numeric DEFAULT 0, -- Percentage improvement vs previous window
  trend_direction text CHECK (trend_direction IN ('improving', 'stable', 'declining')),

  -- Statistical measures
  confidence_variance numeric DEFAULT 0,
  prediction_consistency numeric DEFAULT 0, -- How consistent are confidence levels

  -- Over/Under confidence analysis
  overconfident_trades integer DEFAULT 0, -- High confidence but loss
  underconfident_trades integer DEFAULT 0, -- Low confidence but win
  well_calibrated_trades integer DEFAULT 0, -- Confidence matched outcome

  -- Metadata
  calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 3: Create ai_confidence_history table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_confidence_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Snapshot metadata
  snapshot_date date NOT NULL,
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('daily', 'weekly', 'monthly', 'milestone')),

  -- Summary metrics at time of snapshot
  total_trades_analyzed integer DEFAULT 0,
  current_accuracy_percentage numeric DEFAULT 0,
  current_calibration_score numeric DEFAULT 0,
  current_confidence_error numeric DEFAULT 0,

  -- Trend data
  accuracy_trend jsonb, -- Array of last N accuracy values
  calibration_trend jsonb, -- Array of last N calibration scores

  -- Best/Worst performers
  best_confidence_bucket text,
  best_bucket_accuracy numeric,
  worst_confidence_bucket text,
  worst_bucket_accuracy numeric,

  -- Milestones achieved
  milestones_reached text[], -- e.g., ['90_percent_accuracy', 'perfect_calibration']

  -- Metadata
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 4: Create indexes for performance
-- ============================================================================

-- ai_confidence_calibration indexes
CREATE INDEX IF NOT EXISTS idx_confidence_calibration_user_time
  ON ai_confidence_calibration(user_id, entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_confidence_calibration_trade
  ON ai_confidence_calibration(trade_id, trade_source);

CREATE INDEX IF NOT EXISTS idx_confidence_calibration_bucket
  ON ai_confidence_calibration(user_id, confidence_bucket);

CREATE INDEX IF NOT EXISTS idx_confidence_calibration_accuracy
  ON ai_confidence_calibration(user_id, was_accurate, entry_time DESC);

-- ai_confidence_performance indexes
CREATE INDEX IF NOT EXISTS idx_confidence_performance_user_window
  ON ai_confidence_performance(user_id, window_type, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_confidence_performance_accuracy
  ON ai_confidence_performance(user_id, accuracy_percentage DESC);

-- ai_confidence_history indexes
CREATE INDEX IF NOT EXISTS idx_confidence_history_user_date
  ON ai_confidence_history(user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_confidence_history_type
  ON ai_confidence_history(user_id, snapshot_type, snapshot_date DESC);

-- ============================================================================
-- STEP 5: Enable Row Level Security
-- ============================================================================

ALTER TABLE ai_confidence_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_confidence_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_confidence_history ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 6: Create RLS Policies
-- ============================================================================

-- ai_confidence_calibration policies
DROP POLICY IF EXISTS "Users can view own confidence calibration" ON ai_confidence_calibration;
DROP POLICY IF EXISTS "Users can insert own confidence calibration" ON ai_confidence_calibration;
DROP POLICY IF EXISTS "Service role full access to confidence calibration" ON ai_confidence_calibration;

CREATE POLICY "Users can view own confidence calibration"
  ON ai_confidence_calibration FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own confidence calibration"
  ON ai_confidence_calibration FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to confidence calibration"
  ON ai_confidence_calibration FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_confidence_performance policies
DROP POLICY IF EXISTS "Users can view own confidence performance" ON ai_confidence_performance;
DROP POLICY IF EXISTS "Users can insert own confidence performance" ON ai_confidence_performance;
DROP POLICY IF EXISTS "Users can update own confidence performance" ON ai_confidence_performance;
DROP POLICY IF EXISTS "Service role full access to confidence performance" ON ai_confidence_performance;

CREATE POLICY "Users can view own confidence performance"
  ON ai_confidence_performance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own confidence performance"
  ON ai_confidence_performance FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own confidence performance"
  ON ai_confidence_performance FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to confidence performance"
  ON ai_confidence_performance FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ai_confidence_history policies
DROP POLICY IF EXISTS "Users can view own confidence history" ON ai_confidence_history;
DROP POLICY IF EXISTS "Users can insert own confidence history" ON ai_confidence_history;
DROP POLICY IF EXISTS "Service role full access to confidence history" ON ai_confidence_history;

CREATE POLICY "Users can view own confidence history"
  ON ai_confidence_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own confidence history"
  ON ai_confidence_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to confidence history"
  ON ai_confidence_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- STEP 7: Create helper functions
-- ============================================================================

-- Function to calculate confidence bucket from confidence score
CREATE OR REPLACE FUNCTION get_confidence_bucket(confidence integer)
RETURNS text AS $$
BEGIN
  RETURN CASE
    WHEN confidence >= 0 AND confidence < 20 THEN '0-20'
    WHEN confidence >= 20 AND confidence < 40 THEN '20-40'
    WHEN confidence >= 40 AND confidence < 60 THEN '40-60'
    WHEN confidence >= 60 AND confidence < 80 THEN '60-80'
    WHEN confidence >= 80 AND confidence <= 100 THEN '80-100'
    ELSE 'unknown'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to determine if confidence prediction was accurate
CREATE OR REPLACE FUNCTION is_confidence_accurate(
  confidence integer,
  outcome text
)
RETURNS boolean AS $$
BEGIN
  -- High confidence (>= 70) should result in wins
  -- Low confidence (< 50) is okay with losses
  -- Medium confidence (50-70) is neutral
  IF confidence >= 70 AND outcome = 'win' THEN
    RETURN true;
  ELSIF confidence < 50 AND outcome = 'loss' THEN
    RETURN true;
  ELSIF confidence >= 50 AND confidence < 70 THEN
    RETURN true; -- Medium confidence is always considered reasonable
  ELSE
    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add helpful comments
COMMENT ON TABLE ai_confidence_calibration IS 'Tracks per-trade confidence prediction accuracy to measure AI calibration';
COMMENT ON TABLE ai_confidence_performance IS 'Aggregated confidence accuracy metrics over various time windows';
COMMENT ON TABLE ai_confidence_history IS 'Historical snapshots of confidence performance for trend analysis';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ AI Confidence Tracking System created successfully';
  RAISE NOTICE 'Tables: ai_confidence_calibration, ai_confidence_performance, ai_confidence_history';
  RAISE NOTICE 'Helper functions: get_confidence_bucket(), is_confidence_accurate()';
END $$;
