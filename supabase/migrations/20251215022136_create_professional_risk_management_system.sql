/*
  # Professional Risk Management System

  1. New Tables
    - `kelly_sizing_log` - Tracks Kelly Criterion position sizing decisions
    - `ev_gate_log` - Tracks Expected Value gating decisions
    - `goal_feasibility_log` - Tracks goal feasibility validations
    - `volatility_risk_log` - Tracks volatility-adjusted risk decisions
    - `correlation_risk_log` - Tracks correlation risk checks
    - `drawdown_protection_log` - Tracks drawdown protection triggers
    - `market_condition_log` - Tracks market condition risk adjustments
    - `winrate_rr_optimization_log` - Tracks win rate vs RR optimization
    - `risk_scaling_log` - Tracks progressive risk scaling decisions
    - `critical_risk_events` - Tracks critical risk events (hard stops, etc.)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
*/

-- Kelly Sizing Log
CREATE TABLE IF NOT EXISTS kelly_sizing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  win_rate real NOT NULL,
  avg_win_pips real NOT NULL,
  avg_loss_pips real NOT NULL,
  full_kelly_fraction real NOT NULL,
  fractional_kelly_fraction real NOT NULL,
  recommended_lot_size real NOT NULL,
  risk_amount real NOT NULL,
  edge_strength text NOT NULL CHECK (edge_strength IN ('negative', 'weak', 'moderate', 'strong')),
  reasoning text NOT NULL,
  current_balance real NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kelly_sizing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own Kelly sizing logs"
  ON kelly_sizing_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_kelly_sizing_log_user_created
  ON kelly_sizing_log(user_id, created_at DESC);

-- EV Gate Log
CREATE TABLE IF NOT EXISTS ev_gate_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  win_rate real NOT NULL,
  avg_win_pips real NOT NULL,
  avg_loss_pips real NOT NULL,
  proposed_lot_size real NOT NULL,
  market_condition text,
  session_quality text,
  expected_value_pips real NOT NULL,
  expected_value_money real NOT NULL,
  approved boolean NOT NULL,
  confidence_level text NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low', 'very-low')),
  reasoning text NOT NULL,
  recommendations text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ev_gate_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own EV gate logs"
  ON ev_gate_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ev_gate_log_user_created
  ON ev_gate_log(user_id, created_at DESC);

-- Goal Feasibility Log
CREATE TABLE IF NOT EXISTS goal_feasibility_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_balance real NOT NULL,
  target_profit real NOT NULL,
  timeframe_hours integer NOT NULL,
  risk_per_trade real NOT NULL,
  feasible boolean NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'realistic', 'challenging', 'very-difficult', 'unrealistic')),
  required_win_rate real NOT NULL,
  required_trades integer NOT NULL,
  estimated_success_rate real NOT NULL,
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE goal_feasibility_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own goal feasibility logs"
  ON goal_feasibility_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_goal_feasibility_log_user_created
  ON goal_feasibility_log(user_id, created_at DESC);

-- Volatility Risk Log
CREATE TABLE IF NOT EXISTS volatility_risk_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  base_risk_percent real NOT NULL,
  current_atr real NOT NULL,
  adjusted_risk_percent real NOT NULL,
  risk_multiplier real NOT NULL,
  volatility_state text NOT NULL CHECK (volatility_state IN ('very-low', 'low', 'normal', 'high', 'very-high')),
  recommended_stop_loss real NOT NULL,
  reasoning text NOT NULL,
  warnings text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE volatility_risk_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own volatility risk logs"
  ON volatility_risk_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_volatility_risk_log_user_symbol_created
  ON volatility_risk_log(user_id, symbol, created_at DESC);

-- Correlation Risk Log
CREATE TABLE IF NOT EXISTS correlation_risk_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  proposed_symbol text NOT NULL,
  proposed_direction text NOT NULL CHECK (proposed_direction IN ('long', 'short')),
  proposed_lot_size real NOT NULL,
  total_correlation_risk real NOT NULL,
  effective_exposure real NOT NULL,
  approved boolean NOT NULL,
  reasoning text NOT NULL,
  correlated_positions jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE correlation_risk_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own correlation risk logs"
  ON correlation_risk_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_correlation_risk_log_user_created
  ON correlation_risk_log(user_id, created_at DESC);

-- Drawdown Protection Log
CREATE TABLE IF NOT EXISTS drawdown_protection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  current_balance real NOT NULL,
  starting_balance real,
  current_drawdown real NOT NULL,
  breached_level text NOT NULL CHECK (breached_level IN ('none', 'warning', 'soft-stop', 'hard-stop')),
  trading_allowed boolean NOT NULL,
  risk_reduction real NOT NULL,
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE drawdown_protection_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own drawdown protection logs"
  ON drawdown_protection_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_drawdown_protection_log_user_created
  ON drawdown_protection_log(user_id, created_at DESC);

-- Market Condition Log
CREATE TABLE IF NOT EXISTS market_condition_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  time_of_day timestamptz NOT NULL,
  session_quality text NOT NULL CHECK (session_quality IN ('london', 'newyork', 'overlap', 'asian', 'off-hours')),
  liquidity_score real NOT NULL,
  risk_multiplier real NOT NULL,
  spread_multiplier real NOT NULL,
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE market_condition_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own market condition logs"
  ON market_condition_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_market_condition_log_user_created
  ON market_condition_log(user_id, created_at DESC);

-- Win Rate RR Optimization Log
CREATE TABLE IF NOT EXISTS winrate_rr_optimization_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  current_win_rate real NOT NULL,
  current_avg_win real NOT NULL,
  current_avg_loss real NOT NULL,
  current_rr real NOT NULL,
  required_rr real NOT NULL,
  optimal_rr real NOT NULL,
  profitability_score real NOT NULL,
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE winrate_rr_optimization_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own winrate RR optimization logs"
  ON winrate_rr_optimization_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_winrate_rr_optimization_log_user_created
  ON winrate_rr_optimization_log(user_id, created_at DESC);

-- Risk Scaling Log
CREATE TABLE IF NOT EXISTS risk_scaling_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  base_risk_percent real NOT NULL,
  adjusted_risk_percent real NOT NULL,
  scaling_multiplier real NOT NULL,
  performance_streak text NOT NULL CHECK (performance_streak IN ('winning', 'losing', 'neutral')),
  streak_length integer NOT NULL,
  confidence_level text NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE risk_scaling_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own risk scaling logs"
  ON risk_scaling_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_risk_scaling_log_user_created
  ON risk_scaling_log(user_id, created_at DESC);

-- Critical Risk Events
CREATE TABLE IF NOT EXISTS critical_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical', 'emergency')),
  details jsonb NOT NULL DEFAULT '{}',
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE critical_risk_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own critical risk events"
  ON critical_risk_events
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_critical_risk_events_user_created
  ON critical_risk_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_critical_risk_events_unresolved
  ON critical_risk_events(user_id, resolved, created_at DESC) WHERE NOT resolved;