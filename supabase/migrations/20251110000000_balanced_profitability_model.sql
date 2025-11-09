/*
  # Balanced Profitability Model - AI Learning System Transformation

  ## Overview
  This migration transforms Pipnosis from a win-rate-focused system into a Balanced
  Profitability Model that optimizes for Expected Value (EV), Composite Success Score (CSS),
  and smart risk management.

  ## Changes

  ### 1. New Tables
    - `ai_risk_state`: Tracks Defensive Mode activations and risk adjustments
    - `ai_composite_scores`: Stores CSS calculations per session/period
    - `ai_session_learnings`: Daily "What I Learned" summaries with actionable insights
    - `ai_pattern_ev_tracking`: Tracks Expected Value for each pattern over time

  ### 2. Enhanced Tables
    - `ai_trade_analysis`: Added realized_rr, mae, mfe, expected_value, trade_quality_score, volatility_regime
    - `ai_learning_insights`: Added average_rr, expected_value, profit_factor, css_contribution
    - `ai_performance_evolution`: Added composite_success_score, avg_realized_rr, drawdown_percent, in_defensive_mode, risk_adjustment_factor
    - `ai_market_scenario_performance`: Added expected_value, avg_realized_rr, sample_ev_variance

  ### 3. New Functions
    - `calculate_trade_ev()`: Calculates Expected Value for a trade
    - `calculate_css()`: Computes Composite Success Score
    - `get_pattern_ev()`: Retrieves EV for a specific pattern
    - `activate_defensive_mode()`: Triggers defensive mode
    - `deactivate_defensive_mode()`: Exits defensive mode

  ### 4. Security
    - RLS enabled on all new tables
    - User data isolation maintained
    - Admin access for monitoring

  ## Formula Reference

  **Expected Value (EV)**:
  ```
  EV = (Win Probability × Avg Win) − ((1 − Win Probability) × Avg Loss)
  ```

  **Composite Success Score (CSS)**:
  ```
  CSS = (0.4 × Win Rate) + (0.3 × Profit Factor) + (0.2 × Avg R:R) + (0.1 × Drawdown Control)
  ```

  **Risk-Reward (R:R)**:
  ```
  R:R = |Exit Price - Entry Price| / |Entry Price - Stop Loss|
  ```

  **Profit Factor**:
  ```
  PF = Total Wins / Total Losses
  ```
*/

-- ============================================================================
-- PART 1: Enhance Existing Tables with Profitability Metrics
-- ============================================================================

-- Enhance ai_trade_analysis
DO $$
BEGIN
  -- Add realized R:R
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'realized_rr'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN realized_rr numeric(10,2);
    COMMENT ON COLUMN ai_trade_analysis.realized_rr IS 'Actual risk-reward ratio achieved (e.g., 2.5 means 2.5R profit)';
  END IF;

  -- Add MAE (Maximum Adverse Excursion)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'mae'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN mae numeric(10,2);
    COMMENT ON COLUMN ai_trade_analysis.mae IS 'Maximum Adverse Excursion in pips - how far price moved against before closing';
  END IF;

  -- Add MFE (Maximum Favorable Excursion)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'mfe'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN mfe numeric(10,2);
    COMMENT ON COLUMN ai_trade_analysis.mfe IS 'Maximum Favorable Excursion in pips - how far price moved in favor before closing';
  END IF;

  -- Add Expected Value
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'expected_value'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN expected_value numeric(12,2);
    COMMENT ON COLUMN ai_trade_analysis.expected_value IS 'Calculated EV at entry: (Win Prob × Avg Win) - ((1 - Win Prob) × Avg Loss)';
  END IF;

  -- Add Trade Quality Score
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'trade_quality_score'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN trade_quality_score numeric(5,2);
    COMMENT ON COLUMN ai_trade_analysis.trade_quality_score IS 'Overall trade execution quality (0-100) based on entry/exit efficiency';
  END IF;

  -- Add Volatility Regime
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'volatility_regime'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN volatility_regime text;
    COMMENT ON COLUMN ai_trade_analysis.volatility_regime IS 'Market volatility at entry: low, medium, high';
  END IF;
END $$;

-- Enhance ai_learning_insights
DO $$
BEGIN
  -- Add Average R:R
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'average_rr'
  ) THEN
    ALTER TABLE ai_learning_insights ADD COLUMN average_rr numeric(10,2) DEFAULT 0;
    COMMENT ON COLUMN ai_learning_insights.average_rr IS 'Average risk-reward ratio for this pattern';
  END IF;

  -- Add Expected Value
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'expected_value'
  ) THEN
    ALTER TABLE ai_learning_insights ADD COLUMN expected_value numeric(12,2) DEFAULT 0;
    COMMENT ON COLUMN ai_learning_insights.expected_value IS 'Expected Value for this pattern';
  END IF;

  -- Add Profit Factor
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'profit_factor'
  ) THEN
    ALTER TABLE ai_learning_insights ADD COLUMN profit_factor numeric(10,2) DEFAULT 0;
    COMMENT ON COLUMN ai_learning_insights.profit_factor IS 'Total wins / total losses for this pattern';
  END IF;

  -- Add CSS Contribution
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_learning_insights' AND column_name = 'css_contribution'
  ) THEN
    ALTER TABLE ai_learning_insights ADD COLUMN css_contribution numeric(5,2) DEFAULT 0;
    COMMENT ON COLUMN ai_learning_insights.css_contribution IS 'How much this pattern contributes to overall CSS (0-100)';
  END IF;
END $$;

-- Enhance ai_performance_evolution
DO $$
BEGIN
  -- Add Composite Success Score
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_performance_evolution' AND column_name = 'composite_success_score'
  ) THEN
    ALTER TABLE ai_performance_evolution ADD COLUMN composite_success_score numeric(5,2);
    COMMENT ON COLUMN ai_performance_evolution.composite_success_score IS 'CSS = (0.4×WR) + (0.3×PF) + (0.2×RR) + (0.1×DD_Control)';
  END IF;

  -- Add Average Realized R:R
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_performance_evolution' AND column_name = 'avg_realized_rr'
  ) THEN
    ALTER TABLE ai_performance_evolution ADD COLUMN avg_realized_rr numeric(10,2);
    COMMENT ON COLUMN ai_performance_evolution.avg_realized_rr IS 'Average risk-reward ratio actually achieved';
  END IF;

  -- Add Drawdown Percent
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_performance_evolution' AND column_name = 'drawdown_percent'
  ) THEN
    ALTER TABLE ai_performance_evolution ADD COLUMN drawdown_percent numeric(5,2) DEFAULT 0;
    COMMENT ON COLUMN ai_performance_evolution.drawdown_percent IS 'Session drawdown as percentage';
  END IF;

  -- Add Defensive Mode Flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_performance_evolution' AND column_name = 'in_defensive_mode'
  ) THEN
    ALTER TABLE ai_performance_evolution ADD COLUMN in_defensive_mode boolean DEFAULT false;
    COMMENT ON COLUMN ai_performance_evolution.in_defensive_mode IS 'Whether defensive mode was active during this period';
  END IF;

  -- Add Risk Adjustment Factor
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_performance_evolution' AND column_name = 'risk_adjustment_factor'
  ) THEN
    ALTER TABLE ai_performance_evolution ADD COLUMN risk_adjustment_factor numeric(3,2) DEFAULT 1.0;
    COMMENT ON COLUMN ai_performance_evolution.risk_adjustment_factor IS 'Risk multiplier: 1.0 = normal, 0.5 = reduced, etc.';
  END IF;
END $$;

-- Enhance ai_market_scenario_performance
DO $$
BEGIN
  -- Add Expected Value
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_market_scenario_performance' AND column_name = 'expected_value'
  ) THEN
    ALTER TABLE ai_market_scenario_performance ADD COLUMN expected_value numeric(12,2) DEFAULT 0;
    COMMENT ON COLUMN ai_market_scenario_performance.expected_value IS 'Expected Value for this market scenario';
  END IF;

  -- Add Average Realized R:R
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_market_scenario_performance' AND column_name = 'avg_realized_rr'
  ) THEN
    ALTER TABLE ai_market_scenario_performance ADD COLUMN avg_realized_rr numeric(10,2) DEFAULT 0;
    COMMENT ON COLUMN ai_market_scenario_performance.avg_realized_rr IS 'Average R:R achieved in this scenario';
  END IF;

  -- Add Sample EV Variance
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_market_scenario_performance' AND column_name = 'sample_ev_variance'
  ) THEN
    ALTER TABLE ai_market_scenario_performance ADD COLUMN sample_ev_variance numeric(12,2) DEFAULT 0;
    COMMENT ON COLUMN ai_market_scenario_performance.sample_ev_variance IS 'Statistical variance in EV - measures consistency';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Create New Tables
-- ============================================================================

-- ai_risk_state: Tracks defensive mode and risk adjustments
CREATE TABLE IF NOT EXISTS ai_risk_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Risk state
  is_defensive_mode_active boolean DEFAULT false,
  risk_adjustment_factor numeric(3,2) DEFAULT 1.0,
  current_drawdown_percent numeric(5,2) DEFAULT 0,
  consecutive_losses integer DEFAULT 0,

  -- Activation details
  defensive_mode_activated_at timestamptz,
  defensive_mode_activation_reason text,
  defensive_mode_trigger_type text CHECK (defensive_mode_trigger_type IN ('drawdown', 'consecutive_losses', 'manual')),

  -- Defensive mode settings
  min_confidence_threshold_override numeric(5,2),
  min_profit_factor_filter numeric(10,2),
  volatility_pause_enabled boolean DEFAULT false,

  -- Deactivation tracking
  defensive_mode_deactivated_at timestamptz,
  defensive_mode_duration_minutes integer,
  trades_during_defensive_mode integer DEFAULT 0,
  recovery_win_count integer DEFAULT 0,

  -- Metadata
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_ai_risk_state_user ON ai_risk_state(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_risk_state_active ON ai_risk_state(user_id, is_defensive_mode_active)
  WHERE is_defensive_mode_active = true;

-- ai_composite_scores: CSS calculations per session/period
CREATE TABLE IF NOT EXISTS ai_composite_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Time period
  measurement_date date NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),

  -- CSS components
  win_rate_component numeric(5,2) DEFAULT 0,
  profit_factor_component numeric(5,2) DEFAULT 0,
  avg_rr_component numeric(5,2) DEFAULT 0,
  drawdown_control_component numeric(5,2) DEFAULT 0,

  -- Calculated CSS
  composite_success_score numeric(5,2) NOT NULL,

  -- Raw metrics for reference
  win_rate numeric(5,2) DEFAULT 0,
  profit_factor numeric(10,2) DEFAULT 0,
  avg_rr numeric(10,2) DEFAULT 0,
  max_drawdown numeric(5,2) DEFAULT 0,

  -- Sample size
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,

  -- Comparison
  previous_css numeric(5,2),
  css_change_percent numeric(5,2),
  is_improving boolean DEFAULT false,

  -- Metadata
  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, measurement_date, period_type)
);

-- Create indexes for CSS queries
CREATE INDEX IF NOT EXISTS idx_ai_composite_scores_user_date
  ON ai_composite_scores(user_id, measurement_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_composite_scores_period
  ON ai_composite_scores(user_id, period_type, measurement_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_composite_scores_css
  ON ai_composite_scores(composite_success_score DESC);

-- ai_session_learnings: Daily summaries with insights
CREATE TABLE IF NOT EXISTS ai_session_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Session identification
  session_date date NOT NULL,
  session_type text DEFAULT 'live_trading' CHECK (session_type IN ('live_trading', 'backtest', 'synthetic')),

  -- Best/Worst setups
  best_setup_name text,
  best_setup_ev numeric(12,2),
  best_setup_win_rate numeric(5,2),
  best_setup_trades_count integer,

  worst_setup_name text,
  worst_setup_ev numeric(12,2),
  worst_setup_win_rate numeric(5,2),
  worst_setup_trades_count integer,

  -- Confidence shifts applied
  confidence_adjustments jsonb DEFAULT '[]'::jsonb,
  net_confidence_shift numeric(5,2) DEFAULT 0,

  -- Filter/threshold adjustments
  filter_adjustments jsonb DEFAULT '[]'::jsonb,
  threshold_adjustments jsonb DEFAULT '[]'::jsonb,

  -- Key discoveries
  patterns_discovered text[] DEFAULT ARRAY[]::text[],
  patterns_degraded text[] DEFAULT ARRAY[]::text[],
  key_learnings text[] DEFAULT ARRAY[]::text[],

  -- Session metrics
  session_css numeric(5,2),
  session_ev numeric(12,2),
  trades_taken integer DEFAULT 0,
  trades_avoided integer DEFAULT 0,

  -- Recommendations for next session
  actionable_recommendations text[] DEFAULT ARRAY[]::text[],

  -- Metadata
  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, session_date, session_type)
);

-- Create indexes for session learnings
CREATE INDEX IF NOT EXISTS idx_ai_session_learnings_user_date
  ON ai_session_learnings(user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_session_learnings_type
  ON ai_session_learnings(user_id, session_type, session_date DESC);

-- ai_pattern_ev_tracking: Track EV for patterns over time
CREATE TABLE IF NOT EXISTS ai_pattern_ev_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Pattern identification
  pattern_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text DEFAULT 'H1',
  volatility_regime text CHECK (volatility_regime IN ('low', 'medium', 'high')),

  -- EV tracking
  expected_value numeric(12,2) NOT NULL,
  win_probability numeric(5,2) NOT NULL,
  avg_win_amount numeric(12,2) NOT NULL,
  avg_loss_amount numeric(12,2) NOT NULL,

  -- Performance metrics
  sample_size integer NOT NULL,
  win_count integer DEFAULT 0,
  loss_count integer DEFAULT 0,
  avg_rr numeric(10,2) DEFAULT 0,
  profit_factor numeric(10,2) DEFAULT 0,

  -- Quality indicators
  ev_confidence_level text DEFAULT 'low' CHECK (ev_confidence_level IN ('low', 'medium', 'high')),
  is_statistically_significant boolean DEFAULT false,
  pattern_status text DEFAULT 'active' CHECK (pattern_status IN ('active', 'degraded', 'paused', 'archived')),

  -- Tracking
  first_seen_at timestamptz DEFAULT now(),
  last_updated_at timestamptz DEFAULT now(),
  last_trade_at timestamptz,

  -- Metadata
  created_at timestamptz DEFAULT now(),

  UNIQUE(user_id, pattern_name, symbol, volatility_regime)
);

-- Create indexes for pattern EV tracking
CREATE INDEX IF NOT EXISTS idx_ai_pattern_ev_user_symbol
  ON ai_pattern_ev_tracking(user_id, symbol, expected_value DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_ev_status
  ON ai_pattern_ev_tracking(user_id, pattern_status, expected_value DESC);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_ev_value
  ON ai_pattern_ev_tracking(expected_value DESC)
  WHERE pattern_status = 'active';

-- ============================================================================
-- PART 3: Enable RLS on New Tables
-- ============================================================================

ALTER TABLE ai_risk_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_composite_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_session_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pattern_ev_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_risk_state
CREATE POLICY "Users can view own risk state"
  ON ai_risk_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own risk state"
  ON ai_risk_state FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own risk state"
  ON ai_risk_state FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for ai_composite_scores
CREATE POLICY "Users can view own CSS"
  ON ai_composite_scores FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own CSS"
  ON ai_composite_scores FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for ai_session_learnings
CREATE POLICY "Users can view own session learnings"
  ON ai_session_learnings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session learnings"
  ON ai_session_learnings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for ai_pattern_ev_tracking
CREATE POLICY "Users can view own pattern EV"
  ON ai_pattern_ev_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own pattern EV"
  ON ai_pattern_ev_tracking FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PART 4: Create Helper Functions
-- ============================================================================

-- Function to calculate Expected Value
CREATE OR REPLACE FUNCTION calculate_trade_ev(
  p_win_probability numeric,
  p_avg_win numeric,
  p_avg_loss numeric
)
RETURNS numeric AS $$
BEGIN
  -- EV = (Win Probability × Avg Win) − ((1 − Win Probability) × Avg Loss)
  RETURN (p_win_probability * p_avg_win) - ((1 - p_win_probability) * p_avg_loss);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate Composite Success Score
CREATE OR REPLACE FUNCTION calculate_css(
  p_win_rate numeric,
  p_profit_factor numeric,
  p_avg_rr numeric,
  p_drawdown numeric
)
RETURNS numeric AS $$
DECLARE
  v_wr_component numeric;
  v_pf_component numeric;
  v_rr_component numeric;
  v_dd_component numeric;
  v_css numeric;
BEGIN
  -- Normalize win rate (0-100 to 0-1)
  v_wr_component := (p_win_rate / 100) * 0.4;

  -- Normalize profit factor (cap at 3.0, normalize to 0-1)
  v_pf_component := (LEAST(p_profit_factor, 3.0) / 3.0) * 0.3;

  -- Normalize R:R (cap at 3.0, normalize to 0-1)
  v_rr_component := (LEAST(p_avg_rr, 3.0) / 3.0) * 0.2;

  -- Drawdown control (inverse - lower is better, cap at 20%)
  v_dd_component := (1 - (LEAST(p_drawdown, 20) / 20)) * 0.1;

  -- Calculate CSS (result is 0-1, multiply by 100 for 0-100 score)
  v_css := (v_wr_component + v_pf_component + v_rr_component + v_dd_component) * 100;

  RETURN v_css;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get pattern EV
CREATE OR REPLACE FUNCTION get_pattern_ev(
  p_user_id uuid,
  p_pattern_name text,
  p_symbol text,
  p_volatility_regime text DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
  v_ev numeric;
BEGIN
  SELECT expected_value INTO v_ev
  FROM ai_pattern_ev_tracking
  WHERE user_id = p_user_id
    AND pattern_name = p_pattern_name
    AND symbol = p_symbol
    AND (p_volatility_regime IS NULL OR volatility_regime = p_volatility_regime)
    AND pattern_status = 'active'
  ORDER BY last_updated_at DESC
  LIMIT 1;

  RETURN COALESCE(v_ev, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to activate defensive mode
CREATE OR REPLACE FUNCTION activate_defensive_mode(
  p_user_id uuid,
  p_reason text,
  p_trigger_type text,
  p_current_drawdown numeric DEFAULT 0,
  p_consecutive_losses integer DEFAULT 0
)
RETURNS uuid AS $$
DECLARE
  v_risk_state_id uuid;
BEGIN
  -- Insert or update risk state
  INSERT INTO ai_risk_state (
    user_id,
    is_defensive_mode_active,
    risk_adjustment_factor,
    current_drawdown_percent,
    consecutive_losses,
    defensive_mode_activated_at,
    defensive_mode_activation_reason,
    defensive_mode_trigger_type,
    min_confidence_threshold_override,
    min_profit_factor_filter,
    volatility_pause_enabled
  ) VALUES (
    p_user_id,
    true,
    0.5, -- Reduce risk to 50%
    p_current_drawdown,
    p_consecutive_losses,
    now(),
    p_reason,
    p_trigger_type,
    80, -- Require 80% confidence
    1.5, -- Require 1.5+ profit factor
    true -- Pause during volatility spikes
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    is_defensive_mode_active = true,
    risk_adjustment_factor = 0.5,
    current_drawdown_percent = p_current_drawdown,
    consecutive_losses = p_consecutive_losses,
    defensive_mode_activated_at = now(),
    defensive_mode_activation_reason = p_reason,
    defensive_mode_trigger_type = p_trigger_type,
    min_confidence_threshold_override = 80,
    min_profit_factor_filter = 1.5,
    volatility_pause_enabled = true,
    last_updated = now()
  RETURNING id INTO v_risk_state_id;

  RETURN v_risk_state_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to deactivate defensive mode
CREATE OR REPLACE FUNCTION deactivate_defensive_mode(
  p_user_id uuid,
  p_recovery_win_count integer DEFAULT 1
)
RETURNS boolean AS $$
DECLARE
  v_duration_minutes integer;
  v_trades_during integer;
BEGIN
  -- Calculate duration
  SELECT
    EXTRACT(EPOCH FROM (now() - defensive_mode_activated_at)) / 60,
    trades_during_defensive_mode
  INTO v_duration_minutes, v_trades_during
  FROM ai_risk_state
  WHERE user_id = p_user_id AND is_defensive_mode_active = true;

  -- Update risk state
  UPDATE ai_risk_state
  SET
    is_defensive_mode_active = false,
    risk_adjustment_factor = 1.0,
    defensive_mode_deactivated_at = now(),
    defensive_mode_duration_minutes = v_duration_minutes,
    recovery_win_count = p_recovery_win_count,
    min_confidence_threshold_override = NULL,
    min_profit_factor_filter = NULL,
    volatility_pause_enabled = false,
    last_updated = now()
  WHERE user_id = p_user_id AND is_defensive_mode_active = true;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 5: Create Views for Easy Querying
-- ============================================================================

-- View: Latest CSS per user
CREATE OR REPLACE VIEW v_latest_css AS
SELECT DISTINCT ON (user_id)
  user_id,
  measurement_date,
  period_type,
  composite_success_score,
  win_rate,
  profit_factor,
  avg_rr,
  max_drawdown,
  total_trades,
  css_change_percent,
  is_improving
FROM ai_composite_scores
ORDER BY user_id, measurement_date DESC;

-- View: Active defensive mode users
CREATE OR REPLACE VIEW v_active_defensive_mode AS
SELECT
  user_id,
  risk_adjustment_factor,
  current_drawdown_percent,
  consecutive_losses,
  defensive_mode_activated_at,
  defensive_mode_activation_reason,
  trades_during_defensive_mode,
  EXTRACT(EPOCH FROM (now() - defensive_mode_activated_at)) / 60 as duration_minutes
FROM ai_risk_state
WHERE is_defensive_mode_active = true;

-- View: Top patterns by EV
CREATE OR REPLACE VIEW v_top_patterns_by_ev AS
SELECT
  user_id,
  pattern_name,
  symbol,
  expected_value,
  win_probability,
  avg_rr,
  profit_factor,
  sample_size,
  pattern_status
FROM ai_pattern_ev_tracking
WHERE pattern_status = 'active'
ORDER BY expected_value DESC;

-- ============================================================================
-- PART 6: Add Comments for Documentation
-- ============================================================================

COMMENT ON TABLE ai_risk_state IS 'Tracks Defensive Mode activations and risk management state';
COMMENT ON TABLE ai_composite_scores IS 'Stores Composite Success Score calculations per period';
COMMENT ON TABLE ai_session_learnings IS 'Daily "What I Learned" summaries with actionable insights';
COMMENT ON TABLE ai_pattern_ev_tracking IS 'Tracks Expected Value for trading patterns over time';

COMMENT ON FUNCTION calculate_trade_ev IS 'Calculates Expected Value: (Win Prob × Avg Win) - ((1 - Win Prob) × Avg Loss)';
COMMENT ON FUNCTION calculate_css IS 'Calculates Composite Success Score: (0.4×WR) + (0.3×PF) + (0.2×RR) + (0.1×DD)';
COMMENT ON FUNCTION get_pattern_ev IS 'Retrieves Expected Value for a specific pattern and symbol';
COMMENT ON FUNCTION activate_defensive_mode IS 'Activates defensive mode with reduced risk and higher thresholds';
COMMENT ON FUNCTION deactivate_defensive_mode IS 'Deactivates defensive mode and returns to normal trading';
