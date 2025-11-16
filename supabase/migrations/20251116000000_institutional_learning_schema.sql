/*
  # Institutional-Grade AI Learning System - Enhanced Schema

  ## Overview
  This migration creates the foundation for institutional-grade AI learning capabilities including:
  - Market regime tracking with session context
  - Pattern-context performance correlation
  - Trade sequence analysis
  - Currency correlation matrices
  - Loss forensics and failure analysis
  - Timing optimization data
  - Adaptive confidence calibration
  - Economic events integration
  - Monte Carlo simulation results
  - Intelligent position sizing recommendations

  ## New Tables
  1. `market_regime_history` - Historical market regime data with session context
  2. `pattern_context_performance` - Pattern performance by market conditions
  3. `trade_sequence_analysis` - Sequential trade pattern tracking
  4. `currency_correlation_matrix` - Real-time pair correlation data
  5. `loss_forensics` - Deep failure analysis for every losing trade
  6. `timing_optimization_data` - Entry/exit timing precision metrics
  7. `confidence_calibration_history` - Adaptive confidence scoring over time
  8. `economic_events` - News calendar with impact tracking
  9. `monte_carlo_simulations` - Stress test probability distributions
  10. `position_sizing_recommendations` - Kelly Criterion based sizing

  ## Security
  - All tables use RLS policies
  - User-scoped data access
  - Admin access for system-wide analytics
*/

-- 1. Market Regime History with Session Context
CREATE TABLE IF NOT EXISTS market_regime_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  detected_at timestamptz DEFAULT now() NOT NULL,

  -- Regime Classification
  regime_type text NOT NULL CHECK (regime_type IN ('trending_up', 'trending_down', 'ranging', 'mixed')),
  volatility_level text NOT NULL CHECK (volatility_level IN ('low', 'medium', 'high', 'extreme')),
  trend_strength numeric NOT NULL CHECK (trend_strength >= 0 AND trend_strength <= 100),
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- Session Context
  session_type text NOT NULL CHECK (session_type IN ('asian', 'london', 'newyork', 'overlap')),
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour_of_day integer NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),

  -- Technical Characteristics
  atr numeric NOT NULL,
  atr_percentile numeric NOT NULL CHECK (atr_percentile >= 0 AND atr_percentile <= 100),
  adx numeric,
  price_location text CHECK (price_location IN ('near_high', 'near_low', 'middle')),
  volume_trend text CHECK (volume_trend IN ('increasing', 'decreasing', 'stable')),

  -- Additional Context
  is_news_period boolean DEFAULT false,
  upcoming_event text,
  metadata jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_market_regime_user_symbol ON market_regime_history(user_id, symbol, detected_at DESC);
CREATE INDEX idx_market_regime_session ON market_regime_history(session_type, hour_of_day);
CREATE INDEX idx_market_regime_type ON market_regime_history(regime_type, volatility_level);

-- 2. Pattern Context Performance (Links patterns to specific market conditions)
CREATE TABLE IF NOT EXISTS pattern_context_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_id text NOT NULL,
  pattern_name text NOT NULL,
  symbol text NOT NULL,

  -- Market Context
  regime_type text NOT NULL,
  volatility_level text NOT NULL,
  session_type text NOT NULL,
  hour_of_day integer NOT NULL,
  day_of_week integer NOT NULL,

  -- Performance Metrics
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_win numeric DEFAULT 0,
  avg_loss numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  expected_value numeric DEFAULT 0,
  sharpe_ratio numeric DEFAULT 0,

  -- Timing Metrics
  avg_holding_duration_minutes integer,
  optimal_entry_candle_position text, -- 'open', 'mid', 'close'
  avg_entry_slippage_pips numeric,

  -- Sample Size & Confidence
  sample_size integer DEFAULT 0,
  confidence_level text CHECK (confidence_level IN ('low', 'medium', 'high')),
  statistical_significance boolean DEFAULT false,

  -- Timestamps
  first_trade_at timestamptz,
  last_trade_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pattern_context_user ON pattern_context_performance(user_id, pattern_name);
CREATE INDEX idx_pattern_context_regime ON pattern_context_performance(regime_type, volatility_level, session_type);
CREATE INDEX idx_pattern_context_performance ON pattern_context_performance(win_rate DESC, profit_factor DESC);

-- 3. Trade Sequence Analysis (Track patterns across consecutive trades)
CREATE TABLE IF NOT EXISTS trade_sequence_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sequence_id uuid NOT NULL,

  -- Sequence Metadata
  sequence_type text NOT NULL CHECK (sequence_type IN ('win_streak', 'loss_streak', 'alternating', 'recovery', 'breakdown')),
  sequence_length integer NOT NULL CHECK (sequence_length >= 2),
  trade_ids uuid[] NOT NULL,

  -- Sequence Performance
  total_pnl numeric NOT NULL,
  avg_trade_pnl numeric NOT NULL,
  sequence_win_rate numeric,

  -- Pattern Detection
  pattern_detected text,
  confidence numeric CHECK (confidence >= 0 AND confidence <= 100),

  -- Context
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  session_type text,
  market_regime text,

  -- Insights
  key_insight text,
  recommendation text,
  should_continue_trading boolean,
  suggested_position_size_adjustment numeric, -- multiplier: 0.5 = half size, 1.5 = 50% larger

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_sequence_user_type ON trade_sequence_analysis(user_id, sequence_type, started_at DESC);
CREATE INDEX idx_sequence_pattern ON trade_sequence_analysis(pattern_detected);

-- 4. Currency Correlation Matrix (Real-time pair correlation)
CREATE TABLE IF NOT EXISTS currency_correlation_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculated_at timestamptz DEFAULT now() NOT NULL,
  timeframe text NOT NULL,
  lookback_period integer NOT NULL, -- hours

  -- Pair Correlation (e.g., EURUSD vs GBPUSD)
  pair_1 text NOT NULL,
  pair_2 text NOT NULL,
  correlation_coefficient numeric NOT NULL CHECK (correlation_coefficient >= -1 AND correlation_coefficient <= 1),

  -- Statistical Measures
  p_value numeric, -- statistical significance
  sample_size integer NOT NULL,

  -- Correlation Strength
  correlation_strength text CHECK (correlation_strength IN ('very_weak', 'weak', 'moderate', 'strong', 'very_strong')),

  -- Trading Implications
  risk_multiplier numeric DEFAULT 1.0, -- if highly correlated, reduce combined position size
  divergence_opportunity boolean DEFAULT false,
  mean_reversion_setup boolean DEFAULT false,

  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_correlation_pairs ON currency_correlation_matrix(pair_1, pair_2, calculated_at DESC);
CREATE INDEX idx_correlation_strength ON currency_correlation_matrix(correlation_strength, calculated_at DESC);

-- 5. Loss Forensics (Deep analysis of every losing trade)
CREATE TABLE IF NOT EXISTS loss_forensics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid NOT NULL,

  -- Trade Basic Info
  symbol text NOT NULL,
  direction text NOT NULL,
  entry_time timestamptz NOT NULL,
  exit_time timestamptz NOT NULL,
  pnl numeric NOT NULL,

  -- Loss Category
  loss_type text NOT NULL CHECK (loss_type IN (
    'false_breakout', 'premature_entry', 'late_entry', 'stop_too_tight',
    'ignored_divergence', 'news_event', 'poor_timing', 'wrong_regime',
    'overtrading', 'revenge_trading', 'fomo', 'technical_failure'
  )),

  -- Pre-Trade Red Flags (What should have prevented this trade?)
  red_flags text[] DEFAULT ARRAY[]::text[],
  red_flag_count integer DEFAULT 0,
  should_have_skipped boolean DEFAULT false,

  -- Context at Entry
  market_regime_at_entry text,
  volatility_at_entry text,
  session_at_entry text,
  news_events_nearby text[],
  correlation_risk_score numeric, -- 0-100, higher = more correlated exposure

  -- Technical Analysis
  stop_loss_quality text CHECK (stop_loss_quality IN ('too_tight', 'appropriate', 'too_wide')),
  entry_quality_score numeric CHECK (entry_quality_score >= 0 AND entry_quality_score <= 100),
  timeframe_alignment boolean,
  indicator_divergence boolean,

  -- Lessons Learned
  primary_mistake text NOT NULL,
  secondary_mistakes text[],
  actionable_lesson text NOT NULL,
  anti_pattern_created text, -- name of anti-pattern to avoid

  -- Prevention Strategy
  prevention_rule text NOT NULL,
  automated_filter_suggestion text,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_loss_forensics_user ON loss_forensics(user_id, created_at DESC);
CREATE INDEX idx_loss_forensics_type ON loss_forensics(loss_type);
CREATE INDEX idx_loss_forensics_red_flags ON loss_forensics(red_flag_count DESC);

-- 6. Timing Optimization Data (Micro-timeframe entry/exit precision)
CREATE TABLE IF NOT EXISTS timing_optimization_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_name text NOT NULL,
  symbol text NOT NULL,

  -- Entry Timing Analysis
  optimal_entry_method text CHECK (optimal_entry_method IN ('candle_open', 'candle_mid', 'candle_close', 'breakout_confirmation', 'pullback_entry')),
  avg_entry_improvement_pips numeric, -- vs immediate entry
  entry_timing_confidence numeric CHECK (entry_timing_confidence >= 0 AND entry_timing_confidence <= 100),

  -- Exit Timing Analysis
  optimal_exit_method text CHECK (optimal_exit_method IN ('fixed_tp', 'trailing_stop', 'time_based', 'indicator_based', 'partial_exit')),
  avg_exit_improvement_pips numeric,
  optimal_holding_minutes integer,
  exit_timing_confidence numeric CHECK (exit_timing_confidence >= 0 AND exit_timing_confidence <= 100),

  -- Partial Exit Strategy
  first_exit_percentage numeric, -- e.g., 50% at 1R
  first_exit_target_rr numeric,
  second_exit_percentage numeric,
  second_exit_target_rr numeric,

  -- Statistical Validation
  sample_size integer NOT NULL,
  backtest_win_rate_improvement numeric, -- percentage points improvement

  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_timing_opt_user_pattern ON timing_optimization_data(user_id, pattern_name);
CREATE INDEX idx_timing_opt_improvement ON timing_optimization_data(avg_entry_improvement_pips DESC);

-- 7. Confidence Calibration History (Adaptive confidence scoring over time)
CREATE TABLE IF NOT EXISTS confidence_calibration_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  calibration_time timestamptz DEFAULT now() NOT NULL,

  -- Base Confidence Factors
  pattern_confidence numeric NOT NULL,
  regime_confidence numeric NOT NULL,
  timing_confidence numeric NOT NULL,
  volatility_confidence numeric NOT NULL,

  -- Contextual Modifiers
  session_modifier numeric DEFAULT 1.0, -- multiplier
  day_of_week_modifier numeric DEFAULT 1.0,
  correlation_modifier numeric DEFAULT 1.0,
  recent_performance_modifier numeric DEFAULT 1.0, -- based on last 20 trades

  -- Recent Performance Context
  last_20_win_rate numeric,
  last_20_profit_factor numeric,
  consecutive_wins integer DEFAULT 0,
  consecutive_losses integer DEFAULT 0,

  -- Calculated Confidence
  base_confidence numeric NOT NULL CHECK (base_confidence >= 0 AND base_confidence <= 100),
  adjusted_confidence numeric NOT NULL CHECK (adjusted_confidence >= 0 AND adjusted_confidence <= 100),
  confidence_adjustment_percent numeric, -- how much was adjusted

  -- Recommendations
  position_size_multiplier numeric DEFAULT 1.0,
  should_trade boolean DEFAULT true,
  skip_reason text,

  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_confidence_calib_user ON confidence_calibration_history(user_id, calibration_time DESC);
CREATE INDEX idx_confidence_calib_adjusted ON confidence_calibration_history(adjusted_confidence DESC);

-- 8. Economic Events (News calendar with impact tracking)
CREATE TABLE IF NOT EXISTS economic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_time timestamptz NOT NULL,
  event_name text NOT NULL,
  currency text NOT NULL, -- USD, EUR, GBP, etc.

  -- Event Classification
  impact_level text NOT NULL CHECK (impact_level IN ('low', 'medium', 'high')),
  event_type text NOT NULL CHECK (event_type IN (
    'interest_rate', 'nfp', 'gdp', 'inflation', 'employment',
    'retail_sales', 'pmi', 'central_bank_speech', 'fomc', 'ecb', 'boe', 'other'
  )),

  -- Expected vs Actual
  forecast_value numeric,
  previous_value numeric,
  actual_value numeric,
  surprise_index numeric, -- how much actual deviated from forecast

  -- Market Impact (learned from historical data)
  avg_volatility_increase_pct numeric,
  avg_range_expansion_pips numeric,
  typical_duration_minutes integer,
  continuation_probability numeric, -- % chance initial move continues
  reversal_probability numeric, -- % chance of reversal after initial move

  -- Trading Recommendations
  avoid_trading_before_minutes integer DEFAULT 30,
  avoid_trading_after_minutes integer DEFAULT 15,
  opportunity_after_minutes integer,

  -- Historical Performance
  times_occurred integer DEFAULT 1,
  last_updated timestamptz DEFAULT now(),

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_economic_events_time ON economic_events(event_time DESC);
CREATE INDEX idx_economic_events_currency ON economic_events(currency, impact_level);
CREATE INDEX idx_economic_events_type ON economic_events(event_type);

-- 9. Monte Carlo Simulations (Stress test results and probability distributions)
CREATE TABLE IF NOT EXISTS monte_carlo_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  simulation_time timestamptz DEFAULT now() NOT NULL,

  -- Simulation Parameters
  strategy_name text NOT NULL,
  simulation_count integer NOT NULL, -- typically 1000 or 10000
  trade_count_per_sim integer NOT NULL,
  initial_balance numeric NOT NULL,

  -- Input Statistics (from backtest)
  base_win_rate numeric NOT NULL,
  base_profit_factor numeric NOT NULL,
  base_avg_win numeric NOT NULL,
  base_avg_loss numeric NOT NULL,

  -- Simulation Results
  mean_final_balance numeric NOT NULL,
  median_final_balance numeric NOT NULL,
  std_dev_final_balance numeric NOT NULL,

  -- Probability Distributions
  prob_profitable numeric NOT NULL, -- % of simulations ending profitable
  prob_exceeds_20pct_gain numeric,
  prob_exceeds_50pct_gain numeric,
  prob_exceeds_100pct_gain numeric,

  -- Risk Metrics
  prob_exceeds_10pct_drawdown numeric,
  prob_exceeds_20pct_drawdown numeric,
  prob_exceeds_30pct_drawdown numeric,
  worst_case_drawdown numeric,
  best_case_balance numeric,

  -- Win/Loss Streak Probabilities
  max_consecutive_wins_mean numeric,
  max_consecutive_losses_mean numeric,
  prob_10_loss_streak numeric,

  -- Confidence Intervals
  balance_95pct_confidence_lower numeric,
  balance_95pct_confidence_upper numeric,

  -- Distribution Data (for charting)
  final_balance_distribution jsonb, -- array of {balance, frequency}
  drawdown_distribution jsonb,

  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_monte_carlo_user ON monte_carlo_simulations(user_id, simulation_time DESC);
CREATE INDEX idx_monte_carlo_strategy ON monte_carlo_simulations(strategy_name);

-- 10. Position Sizing Recommendations (Kelly Criterion and intelligent sizing)
CREATE TABLE IF NOT EXISTS position_sizing_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  calculated_at timestamptz DEFAULT now() NOT NULL,

  -- Trade Context
  symbol text NOT NULL,
  pattern_name text NOT NULL,
  setup_confidence numeric NOT NULL,

  -- Pattern Statistics
  pattern_win_rate numeric NOT NULL,
  pattern_avg_win numeric NOT NULL,
  pattern_avg_loss numeric NOT NULL,
  pattern_sample_size integer NOT NULL,

  -- Kelly Criterion Calculation
  kelly_percentage numeric NOT NULL, -- optimal % of capital
  kelly_fraction numeric DEFAULT 0.5, -- fractional kelly (typically 0.25 to 0.5)
  recommended_risk_percent numeric NOT NULL, -- kelly * fraction

  -- Risk Adjustments
  base_position_size numeric NOT NULL,
  volatility_adjustment numeric DEFAULT 1.0,
  correlation_adjustment numeric DEFAULT 1.0,
  drawdown_adjustment numeric DEFAULT 1.0,
  streak_adjustment numeric DEFAULT 1.0,

  -- Final Recommendation
  final_position_size numeric NOT NULL,
  final_risk_percent numeric NOT NULL,
  max_position_size numeric NOT NULL, -- cap based on account rules

  -- Context Factors
  current_account_balance numeric NOT NULL,
  current_drawdown_pct numeric,
  open_positions_count integer,
  correlated_exposure_pct numeric,
  consecutive_wins integer DEFAULT 0,
  consecutive_losses integer DEFAULT 0,

  -- Reasoning
  size_increase_reason text,
  size_decrease_reason text,

  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_position_sizing_user ON position_sizing_recommendations(user_id, calculated_at DESC);
CREATE INDEX idx_position_sizing_pattern ON position_sizing_recommendations(pattern_name);

-- Enable Row Level Security on all tables
ALTER TABLE market_regime_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_context_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_sequence_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_correlation_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE loss_forensics ENABLE ROW LEVEL SECURITY;
ALTER TABLE timing_optimization_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE confidence_calibration_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE monte_carlo_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_sizing_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data (except economic_events which is global)

-- market_regime_history policies
CREATE POLICY "Users can view own regime history"
  ON market_regime_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own regime history"
  ON market_regime_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- pattern_context_performance policies
CREATE POLICY "Users can view own pattern context"
  ON pattern_context_performance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pattern context"
  ON pattern_context_performance FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pattern context"
  ON pattern_context_performance FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- trade_sequence_analysis policies
CREATE POLICY "Users can view own trade sequences"
  ON trade_sequence_analysis FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trade sequences"
  ON trade_sequence_analysis FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- currency_correlation_matrix policies (global data, all users can read)
CREATE POLICY "All authenticated users can view correlations"
  ON currency_correlation_matrix FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert correlations"
  ON currency_correlation_matrix FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- loss_forensics policies
CREATE POLICY "Users can view own loss forensics"
  ON loss_forensics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own loss forensics"
  ON loss_forensics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- timing_optimization_data policies
CREATE POLICY "Users can view own timing data"
  ON timing_optimization_data FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own timing data"
  ON timing_optimization_data FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own timing data"
  ON timing_optimization_data FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- confidence_calibration_history policies
CREATE POLICY "Users can view own confidence calibration"
  ON confidence_calibration_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own confidence calibration"
  ON confidence_calibration_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- economic_events policies (global data, all users can read)
CREATE POLICY "All authenticated users can view economic events"
  ON economic_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage economic events"
  ON economic_events FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- monte_carlo_simulations policies
CREATE POLICY "Users can view own simulations"
  ON monte_carlo_simulations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own simulations"
  ON monte_carlo_simulations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- position_sizing_recommendations policies
CREATE POLICY "Users can view own position sizing"
  ON position_sizing_recommendations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own position sizing"
  ON position_sizing_recommendations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Enable Realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE market_regime_history;
ALTER PUBLICATION supabase_realtime ADD TABLE economic_events;
ALTER PUBLICATION supabase_realtime ADD TABLE confidence_calibration_history;
ALTER PUBLICATION supabase_realtime ADD TABLE position_sizing_recommendations;
