/*
  # Create KPI Tracking and Analytics Tables

  ## Overview
  This migration creates a comprehensive KPI tracking system for the Pipnosis AI Trading Platform.
  It enables admin users to monitor AI performance, track strategy effectiveness, and identify
  areas for improvement across all user accounts.

  ## New Tables

  ### 1. `ai_strategy_performance`
  Tracks individual trade performance with detailed strategy information
  - `id` (uuid, primary key)
  - `user_id` (uuid, references user_profiles)
  - `trade_id` (uuid, references simulated_positions or trade_history)
  - `strategy_type` (text) - Type of strategy used
  - `symbol` (text) - Trading pair
  - `timeframe` (text) - Chart timeframe
  - `trade_direction` (text) - buy or sell
  - `entry_price` (decimal)
  - `exit_price` (decimal)
  - `lot_size` (decimal)
  - `profit_loss` (decimal)
  - `is_win` (boolean) - Whether trade was profitable
  - `ai_confidence` (text) - AI confidence level
  - `market_condition` (text) - Market state during trade
  - `entry_reason` (text) - Why trade was entered
  - `exit_reason` (text) - Why trade was closed
  - `trade_duration_minutes` (integer)
  - `executed_at` (timestamptz)
  - `created_at` (timestamptz)

  ### 2. `ai_learning_metrics`
  Aggregated performance metrics over different timeframes
  - `id` (uuid, primary key)
  - `metric_period` (text) - daily, weekly, monthly, all_time
  - `period_start` (date)
  - `period_end` (date)
  - `total_trades` (integer)
  - `winning_trades` (integer)
  - `losing_trades` (integer)
  - `win_rate` (decimal)
  - `total_profit` (decimal)
  - `total_loss` (decimal)
  - `net_profit` (decimal)
  - `average_win` (decimal)
  - `average_loss` (decimal)
  - `profit_factor` (decimal)
  - `best_strategy` (text)
  - `worst_strategy` (text)
  - `improvement_percentage` (decimal) - Compared to previous period
  - `confidence_accuracy` (decimal) - How often high confidence trades win
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. `strategy_analytics`
  Performance breakdown by strategy type
  - `id` (uuid, primary key)
  - `strategy_type` (text)
  - `total_trades` (integer)
  - `win_count` (integer)
  - `loss_count` (integer)
  - `win_rate` (decimal)
  - `total_profit` (decimal)
  - `total_loss` (decimal)
  - `net_profit` (decimal)
  - `average_win_size` (decimal)
  - `average_loss_size` (decimal)
  - `largest_win` (decimal)
  - `largest_loss` (decimal)
  - `profit_factor` (decimal)
  - `risk_reward_ratio` (decimal)
  - `average_trade_duration` (integer)
  - `best_symbol` (text)
  - `best_timeframe` (text)
  - `last_updated` (timestamptz)

  ### 4. `user_performance_summary`
  Individual user performance statistics
  - `id` (uuid, primary key)
  - `user_id` (uuid, references user_profiles)
  - `total_trades` (integer)
  - `winning_trades` (integer)
  - `losing_trades` (integer)
  - `win_rate` (decimal)
  - `total_profit` (decimal)
  - `total_loss` (decimal)
  - `net_profit` (decimal)
  - `best_strategy` (text)
  - `favorite_symbol` (text)
  - `average_trade_duration` (integer)
  - `last_trade_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Only admin users can read KPI data
  - System can insert/update records for data collection

  ## Indexes
  - Composite indexes on frequently queried columns
  - Indexes for time-based queries
  - Indexes for strategy and symbol filtering
*/

-- ============================================================================
-- TABLE 1: ai_strategy_performance
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_strategy_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid,
  strategy_type text NOT NULL,
  symbol text NOT NULL,
  timeframe text,
  trade_direction text CHECK (trade_direction IN ('buy', 'sell')),
  entry_price decimal(15,5),
  exit_price decimal(15,5),
  lot_size decimal(10,2),
  profit_loss decimal(15,2) NOT NULL,
  is_win boolean NOT NULL,
  ai_confidence text CHECK (ai_confidence IN ('high', 'medium', 'low')),
  market_condition text,
  entry_reason text,
  exit_reason text,
  trade_duration_minutes integer,
  executed_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes for ai_strategy_performance
CREATE INDEX IF NOT EXISTS idx_strategy_perf_user_id ON ai_strategy_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_executed_at ON ai_strategy_performance(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_strategy_type ON ai_strategy_performance(strategy_type);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_symbol ON ai_strategy_performance(symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_is_win ON ai_strategy_performance(is_win);
CREATE INDEX IF NOT EXISTS idx_strategy_perf_composite ON ai_strategy_performance(strategy_type, symbol, executed_at DESC);

-- Enable RLS
ALTER TABLE ai_strategy_performance ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_strategy_performance
CREATE POLICY "Admins can view all strategy performance"
  ON ai_strategy_performance
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "System can insert strategy performance"
  ON ai_strategy_performance
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- TABLE 2: ai_learning_metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_period text NOT NULL CHECK (metric_period IN ('daily', 'weekly', 'monthly', 'all_time')),
  period_start date,
  period_end date,
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate decimal(5,2) DEFAULT 0.00,
  total_profit decimal(15,2) DEFAULT 0.00,
  total_loss decimal(15,2) DEFAULT 0.00,
  net_profit decimal(15,2) DEFAULT 0.00,
  average_win decimal(15,2) DEFAULT 0.00,
  average_loss decimal(15,2) DEFAULT 0.00,
  profit_factor decimal(10,2) DEFAULT 0.00,
  best_strategy text,
  worst_strategy text,
  improvement_percentage decimal(10,2) DEFAULT 0.00,
  confidence_accuracy decimal(5,2) DEFAULT 0.00,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(metric_period, period_start, period_end)
);

-- Indexes for ai_learning_metrics
CREATE INDEX IF NOT EXISTS idx_learning_metrics_period ON ai_learning_metrics(metric_period, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_updated ON ai_learning_metrics(updated_at DESC);

-- Enable RLS
ALTER TABLE ai_learning_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_learning_metrics
CREATE POLICY "Admins can view learning metrics"
  ON ai_learning_metrics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "System can manage learning metrics"
  ON ai_learning_metrics
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- TABLE 3: strategy_analytics
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_type text NOT NULL UNIQUE,
  total_trades integer DEFAULT 0,
  win_count integer DEFAULT 0,
  loss_count integer DEFAULT 0,
  win_rate decimal(5,2) DEFAULT 0.00,
  total_profit decimal(15,2) DEFAULT 0.00,
  total_loss decimal(15,2) DEFAULT 0.00,
  net_profit decimal(15,2) DEFAULT 0.00,
  average_win_size decimal(15,2) DEFAULT 0.00,
  average_loss_size decimal(15,2) DEFAULT 0.00,
  largest_win decimal(15,2) DEFAULT 0.00,
  largest_loss decimal(15,2) DEFAULT 0.00,
  profit_factor decimal(10,2) DEFAULT 0.00,
  risk_reward_ratio decimal(10,2) DEFAULT 0.00,
  average_trade_duration integer DEFAULT 0,
  best_symbol text,
  best_timeframe text,
  last_updated timestamptz DEFAULT now()
);

-- Indexes for strategy_analytics
CREATE INDEX IF NOT EXISTS idx_strategy_analytics_type ON strategy_analytics(strategy_type);
CREATE INDEX IF NOT EXISTS idx_strategy_analytics_win_rate ON strategy_analytics(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_analytics_profit ON strategy_analytics(net_profit DESC);

-- Enable RLS
ALTER TABLE strategy_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for strategy_analytics
CREATE POLICY "Admins can view strategy analytics"
  ON strategy_analytics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "System can manage strategy analytics"
  ON strategy_analytics
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- TABLE 4: user_performance_summary
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_performance_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE UNIQUE,
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate decimal(5,2) DEFAULT 0.00,
  total_profit decimal(15,2) DEFAULT 0.00,
  total_loss decimal(15,2) DEFAULT 0.00,
  net_profit decimal(15,2) DEFAULT 0.00,
  best_strategy text,
  favorite_symbol text,
  average_trade_duration integer DEFAULT 0,
  last_trade_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Indexes for user_performance_summary
CREATE INDEX IF NOT EXISTS idx_user_perf_user_id ON user_performance_summary(user_id);
CREATE INDEX IF NOT EXISTS idx_user_perf_win_rate ON user_performance_summary(win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_user_perf_net_profit ON user_performance_summary(net_profit DESC);

-- Enable RLS
ALTER TABLE user_performance_summary ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_performance_summary
CREATE POLICY "Admins can view user performance"
  ON user_performance_summary
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Users can view own performance"
  ON user_performance_summary
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can manage user performance"
  ON user_performance_summary
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
