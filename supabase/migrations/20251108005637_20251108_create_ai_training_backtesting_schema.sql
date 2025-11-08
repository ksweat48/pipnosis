/*
  # AI Training & Backtesting System Schema

  ## Overview
  Complete database schema for admin-only AI training, historical backtesting, 
  parameter optimization, and performance analytics.

  ## New Tables
  
  ### 1. `ai_training_parameters` - AI configuration versions
  ### 2. `backtest_sessions` - Backtesting run sessions
  ### 3. `backtest_trades` - Individual simulated trades
  ### 4. `performance_snapshots` - Performance metrics per config
  ### 5. `missed_opportunities` - False negatives tracking
  ### 6. `ai_capability_scores` - Overall capability rating
  ### 7. `threshold_calibration_log` - Parameter adjustment audit trail

  ## Security
  - Admin-only access via RLS policies
  - All tables check user_profiles.is_admin = true
*/

-- ============================================================================
-- TABLE 1: AI TRAINING PARAMETERS (Create first - referenced by others)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_training_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Configuration Identity
  config_name text NOT NULL,
  description text,
  version integer DEFAULT 1,
  is_active boolean DEFAULT false,
  is_baseline boolean DEFAULT false,
  
  -- Confidence Thresholds
  min_flow_v2_confidence integer DEFAULT 70 CHECK (min_flow_v2_confidence >= 0 AND min_flow_v2_confidence <= 100),
  min_ai_conviction integer DEFAULT 75 CHECK (min_ai_conviction >= 0 AND min_ai_conviction <= 100),
  
  -- Risk Mode Thresholds
  low_risk_threshold integer DEFAULT 85,
  medium_risk_threshold integer DEFAULT 75,
  high_risk_threshold integer DEFAULT 70,
  
  -- Filtering Rules
  require_all_phases boolean DEFAULT true,
  allow_counter_trend boolean DEFAULT false,
  min_risk_reward_ratio numeric DEFAULT 1.5,
  max_concurrent_trades integer DEFAULT 2,
  
  -- AI Reasoning Settings
  use_gpt4_reasoning boolean DEFAULT true,
  gpt4_temperature numeric DEFAULT 0.3,
  fallback_on_api_failure boolean DEFAULT true,
  
  -- Market Regime Filters
  allowed_volatility text[] DEFAULT ARRAY['low', 'medium', 'high'],
  allowed_trends text[] DEFAULT ARRAY['strong_bullish', 'bullish', 'sideways', 'bearish', 'strong_bearish'],
  
  -- Position Sizing
  default_position_size_percent numeric DEFAULT 2.0,
  max_position_size_percent numeric DEFAULT 5.0,
  risk_per_trade_percent numeric DEFAULT 1.0,
  
  -- Timeout and Limits
  max_holding_time_minutes integer DEFAULT 480,
  profit_preservation_threshold numeric DEFAULT 80,
  
  -- Performance Tracking
  backtests_run integer DEFAULT 0,
  total_trades_tested integer DEFAULT 0,
  avg_win_rate numeric DEFAULT 0,
  avg_profit_factor numeric DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 2: BACKTEST SESSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS backtest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name text NOT NULL,
  description text,
  
  -- Configuration
  symbols text[] NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  timeframes text[] DEFAULT ARRAY['1h', '5m', '1m'],
  
  -- AI Parameters Used
  ai_config_id uuid REFERENCES ai_training_parameters(id) ON DELETE SET NULL,
  use_gpt4_reasoning boolean DEFAULT false,
  confidence_threshold integer DEFAULT 75,
  risk_mode text DEFAULT 'medium' CHECK (risk_mode IN ('low', 'medium', 'high')),
  max_concurrent_trades integer DEFAULT 2,
  
  -- Execution Settings
  initial_balance numeric DEFAULT 10000,
  position_size_percent numeric DEFAULT 2.0,
  commission_per_trade numeric DEFAULT 0,
  slippage_pips integer DEFAULT 1,
  
  -- Results Summary
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  breakeven_trades integer DEFAULT 0,
  total_pnl numeric DEFAULT 0,
  final_balance numeric DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_win numeric DEFAULT 0,
  avg_loss numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  sharpe_ratio numeric DEFAULT 0,
  max_drawdown numeric DEFAULT 0,
  max_drawdown_percent numeric DEFAULT 0,
  
  -- Execution Metadata
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  candles_processed integer DEFAULT 0,
  signals_generated integer DEFAULT 0,
  signals_executed integer DEFAULT 0,
  signals_skipped integer DEFAULT 0,
  
  -- Cost Tracking
  gpt4_calls_made integer DEFAULT 0,
  estimated_api_cost numeric DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 3: BACKTEST TRADES
-- ============================================================================

CREATE TABLE IF NOT EXISTS backtest_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES backtest_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Trade Identification
  trade_number integer NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  
  -- Entry Details
  entry_time timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  position_size numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  risk_reward_ratio numeric NOT NULL,
  
  -- Signal Details
  flow_v2_confidence integer NOT NULL,
  h1_bias text NOT NULL,
  m5_filter_passed boolean NOT NULL,
  m1_execution_ready boolean NOT NULL,
  setup_type text NOT NULL,
  
  -- AI Decision
  ai_reasoning_used boolean DEFAULT false,
  ai_conviction integer,
  ai_rationale text,
  ai_risk_assessment text,
  should_execute boolean NOT NULL,
  execution_reason text NOT NULL,
  
  -- Exit Details
  exit_time timestamptz,
  exit_price numeric,
  exit_reason text CHECK (exit_reason IN ('take_profit', 'stop_loss', 'trailing_stop', 'timeout', 'session_end')),
  
  -- Results
  pnl numeric DEFAULT 0,
  pnl_percent numeric DEFAULT 0,
  pips_gained numeric DEFAULT 0,
  outcome text CHECK (outcome IN ('win', 'loss', 'breakeven', 'open')),
  holding_duration_minutes integer,
  
  -- Market Context
  market_regime jsonb,
  h1_candle_at_entry jsonb,
  m5_candle_at_entry jsonb,
  m1_candle_at_entry jsonb,
  
  -- Performance Tags
  quality_score integer CHECK (quality_score >= 0 AND quality_score <= 100),
  tags text[],
  notes text,
  
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 4: PERFORMANCE SNAPSHOTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES backtest_sessions(id) ON DELETE CASCADE,
  config_id uuid REFERENCES ai_training_parameters(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Snapshot Identity
  snapshot_name text NOT NULL,
  snapshot_type text DEFAULT 'backtest' CHECK (snapshot_type IN ('backtest', 'live', 'paper')),
  
  -- Period Covered
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  symbols_tested text[],
  
  -- Core Metrics
  total_trades integer NOT NULL,
  winning_trades integer NOT NULL,
  losing_trades integer NOT NULL,
  win_rate numeric NOT NULL,
  
  -- Profitability
  total_pnl numeric NOT NULL,
  avg_win numeric NOT NULL,
  avg_loss numeric NOT NULL,
  profit_factor numeric NOT NULL,
  expectancy numeric NOT NULL,
  
  -- Risk Metrics
  max_drawdown numeric NOT NULL,
  max_drawdown_percent numeric NOT NULL,
  sharpe_ratio numeric,
  sortino_ratio numeric,
  calmar_ratio numeric,
  
  -- Trade Quality
  avg_risk_reward numeric NOT NULL,
  avg_holding_time_minutes integer,
  best_trade_pnl numeric,
  worst_trade_pnl numeric,
  
  -- Execution Quality
  signals_generated integer NOT NULL,
  signals_executed integer NOT NULL,
  execution_rate numeric NOT NULL,
  missed_opportunities integer DEFAULT 0,
  
  -- AI Performance
  ai_decisions_made integer DEFAULT 0,
  ai_agreement_with_flow_v2_percent numeric,
  gpt4_calls_used integer DEFAULT 0,
  api_cost numeric DEFAULT 0,
  
  -- Breakdown by Symbol
  performance_by_symbol jsonb,
  
  -- Breakdown by Setup Type
  performance_by_setup jsonb,
  
  -- Breakdown by Market Regime
  performance_by_regime jsonb,
  
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 5: MISSED OPPORTUNITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS missed_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES backtest_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Opportunity Details
  symbol text NOT NULL,
  timeframe text NOT NULL,
  opportunity_time timestamptz NOT NULL,
  
  -- Signal That Was Skipped
  flow_v2_confidence integer NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  setup_type text NOT NULL,
  
  -- Why It Was Skipped
  skip_reason text NOT NULL,
  ai_conviction integer,
  ai_rationale text,
  threshold_failed text,
  
  -- What If Analysis
  theoretical_exit_time timestamptz,
  theoretical_exit_price numeric,
  theoretical_outcome text,
  theoretical_pnl numeric,
  theoretical_pips numeric,
  
  -- Quality Assessment
  was_quality_trade boolean NOT NULL,
  quality_score integer CHECK (quality_score >= 0 AND quality_score <= 100),
  
  -- Learning Insights
  should_have_taken boolean,
  threshold_adjustment_needed text,
  
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 6: AI CAPABILITY SCORES
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_capability_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Score Identity
  measurement_period text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  
  -- Overall Capability (Target: 75%+)
  overall_capability_percent numeric NOT NULL,
  capability_grade text NOT NULL CHECK (capability_grade IN ('excellent', 'good', 'fair', 'poor')),
  
  -- Component Scores
  signal_quality_score numeric NOT NULL,
  execution_timing_score numeric NOT NULL,
  risk_management_score numeric NOT NULL,
  win_rate_score numeric NOT NULL,
  profit_consistency_score numeric NOT NULL,
  
  -- Breakdown by Symbol
  eurusd_capability numeric,
  xauusd_capability numeric,
  us30_capability numeric,
  gbpusd_capability numeric,
  usdjpy_capability numeric,
  
  -- Breakdown by Market Condition
  trending_market_capability numeric,
  ranging_market_capability numeric,
  high_volatility_capability numeric,
  low_volatility_capability numeric,
  
  -- AI Specific Metrics
  gpt4_decision_accuracy numeric,
  threshold_optimization_score numeric,
  false_negative_rate numeric,
  false_positive_rate numeric,
  
  -- Improvement Tracking
  previous_capability_percent numeric,
  improvement_percent numeric,
  target_capability_percent numeric DEFAULT 75,
  gap_to_target numeric,
  
  -- Recommendations
  primary_weakness text,
  recommended_adjustments jsonb,
  estimated_capability_after_adjustments numeric,
  
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- TABLE 7: THRESHOLD CALIBRATION LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS threshold_calibration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Change Details
  config_id_before uuid REFERENCES ai_training_parameters(id),
  config_id_after uuid REFERENCES ai_training_parameters(id),
  
  -- What Changed
  parameter_changed text NOT NULL,
  value_before text NOT NULL,
  value_after text NOT NULL,
  change_reason text NOT NULL,
  
  -- Performance Comparison
  backtest_session_before uuid REFERENCES backtest_sessions(id),
  backtest_session_after uuid REFERENCES backtest_sessions(id),
  
  win_rate_before numeric,
  win_rate_after numeric,
  win_rate_change numeric,
  
  profit_factor_before numeric,
  profit_factor_after numeric,
  profit_factor_change numeric,
  
  execution_rate_before numeric,
  execution_rate_after numeric,
  execution_rate_change numeric,
  
  -- Decision Outcome
  change_approved boolean DEFAULT false,
  applied_to_live boolean DEFAULT false,
  rollback_performed boolean DEFAULT false,
  
  -- Notes
  hypothesis text,
  actual_result text,
  lessons_learned text,
  
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- AI Training Parameters
CREATE INDEX IF NOT EXISTS idx_ai_training_parameters_user_id ON ai_training_parameters(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_training_parameters_is_active ON ai_training_parameters(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ai_training_parameters_version ON ai_training_parameters(version DESC);

-- Backtest Sessions
CREATE INDEX IF NOT EXISTS idx_backtest_sessions_user_id ON backtest_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_sessions_status ON backtest_sessions(status);
CREATE INDEX IF NOT EXISTS idx_backtest_sessions_date_range ON backtest_sessions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_backtest_sessions_created_at ON backtest_sessions(created_at DESC);

-- Backtest Trades
CREATE INDEX IF NOT EXISTS idx_backtest_trades_session_id ON backtest_trades(session_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol ON backtest_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_outcome ON backtest_trades(outcome);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_entry_time ON backtest_trades(entry_time);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_quality_score ON backtest_trades(quality_score DESC);

-- Performance Snapshots
CREATE INDEX IF NOT EXISTS idx_performance_snapshots_session_id ON performance_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_performance_snapshots_config_id ON performance_snapshots(config_id);
CREATE INDEX IF NOT EXISTS idx_performance_snapshots_date_range ON performance_snapshots(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_performance_snapshots_win_rate ON performance_snapshots(win_rate DESC);

-- Missed Opportunities
CREATE INDEX IF NOT EXISTS idx_missed_opportunities_session_id ON missed_opportunities(session_id);
CREATE INDEX IF NOT EXISTS idx_missed_opportunities_symbol ON missed_opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_missed_opportunities_quality ON missed_opportunities(was_quality_trade) WHERE was_quality_trade = true;

-- AI Capability Scores
CREATE INDEX IF NOT EXISTS idx_ai_capability_scores_user_id ON ai_capability_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_capability_scores_period ON ai_capability_scores(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_ai_capability_scores_overall ON ai_capability_scores(overall_capability_percent DESC);

-- Threshold Calibration Log
CREATE INDEX IF NOT EXISTS idx_threshold_calibration_user_id ON threshold_calibration_log(user_id);
CREATE INDEX IF NOT EXISTS idx_threshold_calibration_approved ON threshold_calibration_log(change_approved);
CREATE INDEX IF NOT EXISTS idx_threshold_calibration_created ON threshold_calibration_log(created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE ai_training_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE missed_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_capability_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE threshold_calibration_log ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for ai_training_parameters
CREATE POLICY "Admins can view AI parameters"
  ON ai_training_parameters FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can manage AI parameters"
  ON ai_training_parameters FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for backtest_sessions
CREATE POLICY "Admins can view all backtest sessions"
  ON backtest_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create backtest sessions"
  ON backtest_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update backtest sessions"
  ON backtest_sessions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for backtest_trades
CREATE POLICY "Admins can view all backtest trades"
  ON backtest_trades FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create backtest trades"
  ON backtest_trades FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for performance_snapshots
CREATE POLICY "Admins can view performance snapshots"
  ON performance_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create performance snapshots"
  ON performance_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for missed_opportunities
CREATE POLICY "Admins can view missed opportunities"
  ON missed_opportunities FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create missed opportunities"
  ON missed_opportunities FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for ai_capability_scores
CREATE POLICY "Admins can view capability scores"
  ON ai_capability_scores FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can manage capability scores"
  ON ai_capability_scores FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admin-only policies for threshold_calibration_log
CREATE POLICY "Admins can view calibration log"
  ON threshold_calibration_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create calibration log entries"
  ON threshold_calibration_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to calculate win rate
CREATE OR REPLACE FUNCTION calculate_win_rate(
  p_winning_trades integer,
  p_total_trades integer
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_total_trades = 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND((p_winning_trades::numeric / p_total_trades::numeric) * 100, 2);
END;
$$;

-- Function to calculate profit factor
CREATE OR REPLACE FUNCTION calculate_profit_factor(
  p_total_wins numeric,
  p_total_losses numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_total_losses = 0 THEN
    RETURN 999.99;
  END IF;
  IF p_total_wins = 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND(p_total_wins / ABS(p_total_losses), 2);
END;
$$;

-- Function to calculate capability score
CREATE OR REPLACE FUNCTION calculate_capability_score(
  p_win_rate numeric,
  p_profit_factor numeric,
  p_execution_rate numeric,
  p_avg_rr numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_capability numeric;
BEGIN
  -- Weighted scoring formula
  -- Win rate: 40%, Profit factor: 30%, Execution: 20%, R:R: 10%
  v_capability := (
    (p_win_rate * 0.4) +
    (LEAST(p_profit_factor * 15, 30) * 0.3) +
    (p_execution_rate * 0.2) +
    (LEAST(p_avg_rr * 5, 10) * 0.1)
  );
  
  RETURN ROUND(LEAST(v_capability, 100), 2);
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update backtest_sessions updated_at
CREATE OR REPLACE FUNCTION update_backtest_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_backtest_session_timestamp ON backtest_sessions;
CREATE TRIGGER trigger_update_backtest_session_timestamp
  BEFORE UPDATE ON backtest_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_backtest_session_timestamp();

-- Update ai_training_parameters updated_at
DROP TRIGGER IF EXISTS trigger_update_ai_params_timestamp ON ai_training_parameters;
CREATE TRIGGER trigger_update_ai_params_timestamp
  BEFORE UPDATE ON ai_training_parameters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
