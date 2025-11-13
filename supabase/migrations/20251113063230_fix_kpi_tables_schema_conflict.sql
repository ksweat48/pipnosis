/*
  # Fix KPI Tables Schema Conflict
  
  ## Problem
  The ai_learning_metrics table was created with a different schema for individual trade learning.
  The KPIs page expects aggregated metrics in ai_learning_metrics.
  
  ## Solution
  1. Rename existing ai_learning_metrics to ai_trade_learning_records
  2. Drop and recreate ai_learning_metrics with correct KPI schema
  3. Recreate missing KPI tables if needed
  4. Fix RLS policies for admin access
  
  ## Tables Modified
  - ai_learning_metrics (renamed to ai_trade_learning_records, then recreated)
  - ai_strategy_performance (ensure exists with correct schema)
  - strategy_analytics (ensure exists with correct schema)
  - user_performance_summary (ensure exists with correct schema)
*/

-- Step 1: Rename the existing ai_learning_metrics table to preserve data
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'ai_learning_metrics'
    AND table_schema = 'public'
  ) THEN
    -- Check if it has the old schema (has decision_id column)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_learning_metrics'
      AND column_name = 'decision_id'
    ) THEN
      ALTER TABLE ai_learning_metrics RENAME TO ai_trade_learning_records;
    END IF;
  END IF;
END $$;

-- Step 2: Create ai_learning_metrics with correct KPI aggregated metrics schema
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

-- Drop old incorrect policies if they exist
DROP POLICY IF EXISTS "Users can create own AI learning metrics" ON ai_learning_metrics;
DROP POLICY IF EXISTS "Users can view own AI learning metrics" ON ai_learning_metrics;

-- Create correct admin-only policies
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

-- Step 3: Ensure ai_strategy_performance exists with correct schema
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
DROP POLICY IF EXISTS "Admins can view all strategy performance" ON ai_strategy_performance;
DROP POLICY IF EXISTS "System can insert strategy performance" ON ai_strategy_performance;

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

-- Step 4: Ensure strategy_analytics exists with correct schema
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

-- Fix RLS policies - drop old ones and create admin-only
DROP POLICY IF EXISTS "Authenticated users view analytics" ON strategy_analytics;
DROP POLICY IF EXISTS "System manages analytics" ON strategy_analytics;
DROP POLICY IF EXISTS "Admins can view strategy analytics" ON strategy_analytics;

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

-- Step 5: Ensure user_performance_summary exists with correct schema
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

-- Fix RLS policies
DROP POLICY IF EXISTS "Admins can view user performance" ON user_performance_summary;
DROP POLICY IF EXISTS "Users can view own performance" ON user_performance_summary;
DROP POLICY IF EXISTS "System manages performance" ON user_performance_summary;

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
