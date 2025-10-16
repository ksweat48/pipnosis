/*
  # AI Trading Brain System Tables

  1. New Tables
    - `ai_trade_decisions` - Stores ChatGPT analysis and reasoning for each trade decision
    - `trade_options` - Stores the 3 risk-variant options (low/medium/high) for user selection
    - `auto_trading_status` - Tracks daily trade count, scanning status, and opportunity windows
    - `strategy_comparison` - Logs performance comparison between FxFlowScalperV2, AI independent, and hybrid
    - `ai_learning_metrics` - Stores trade outcomes for continuous AI improvement
    - `user_trading_preferences` - User preferences for risk tolerance and auto-trading settings

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to access their own data
    - Admin policies for monitoring and analytics

  3. Notes
    - All tables include user_id for multi-user support
    - Timestamps track when AI decisions were made
    - JSON fields store complex analysis data
    - Foreign keys link to existing trade_records and strategy_signals tables
*/

-- AI Trade Decisions Table
CREATE TABLE IF NOT EXISTS ai_trade_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('manual', 'auto')),
  chatgpt_prompt text NOT NULL,
  chatgpt_response jsonb NOT NULL,
  market_context jsonb NOT NULL,
  trade_direction text CHECK (trade_direction IN ('BUY', 'SELL')),
  confidence_score integer CHECK (confidence_score >= 0 AND confidence_score <= 100),
  strategy_used text NOT NULL,
  reasoning text NOT NULL,
  approved boolean DEFAULT false,
  executed boolean DEFAULT false,
  trade_id uuid REFERENCES trade_records(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT valid_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100))
);

-- Trade Options Table (3 risk variants)
CREATE TABLE IF NOT EXISTS trade_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES ai_trade_decisions(id) ON DELETE CASCADE,
  option_type text NOT NULL CHECK (option_type IN ('low_risk', 'medium_risk', 'high_risk')),
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  lot_size numeric NOT NULL,
  estimated_profit numeric NOT NULL,
  estimated_loss numeric NOT NULL,
  risk_reward_ratio numeric NOT NULL,
  confidence integer CHECK (confidence >= 0 AND confidence <= 100),
  reasoning text NOT NULL,
  selected boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Auto Trading Status Table
CREATE TABLE IF NOT EXISTS auto_trading_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean DEFAULT false,
  trades_taken_today integer DEFAULT 0,
  max_daily_trades integer DEFAULT 6,
  last_scan_time timestamptz,
  last_trade_time timestamptz,
  opportunity_window_start timestamptz,
  opportunity_window_end timestamptz,
  scanning_active boolean DEFAULT false,
  last_opportunity_found timestamptz,
  consecutive_no_opportunity_count integer DEFAULT 0,
  daily_pnl numeric DEFAULT 0,
  daily_loss_limit numeric DEFAULT -500,
  emergency_stop boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Strategy Comparison Table
CREATE TABLE IF NOT EXISTS strategy_comparison (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  fxflow_signal jsonb,
  ai_independent_signal jsonb,
  hybrid_signal jsonb,
  strategy_selected text NOT NULL CHECK (strategy_selected IN ('fxflow_baseline', 'ai_independent', 'hybrid')),
  selection_reason text NOT NULL,
  fxflow_confidence integer,
  ai_confidence integer,
  hybrid_confidence integer,
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven', 'pending')),
  pnl numeric,
  created_at timestamptz DEFAULT now(),
  outcome_recorded_at timestamptz
);

-- AI Learning Metrics Table
CREATE TABLE IF NOT EXISTS ai_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trade_records(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES ai_trade_decisions(id) ON DELETE CASCADE,
  strategy_used text NOT NULL,
  predicted_confidence integer NOT NULL,
  actual_outcome text NOT NULL CHECK (actual_outcome IN ('win', 'loss', 'breakeven')),
  predicted_pnl numeric,
  actual_pnl numeric,
  accuracy_score numeric,
  market_conditions jsonb NOT NULL,
  indicators_used jsonb NOT NULL,
  lessons_learned text,
  created_at timestamptz DEFAULT now()
);

-- User Trading Preferences Table
CREATE TABLE IF NOT EXISTS user_trading_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  risk_tolerance text DEFAULT 'medium' CHECK (risk_tolerance IN ('low', 'medium', 'high')),
  preferred_pairs text[] DEFAULT ARRAY['EURUSD', 'GBPUSD', 'XAUUSD'],
  max_position_size numeric DEFAULT 1.0,
  default_risk_per_trade numeric DEFAULT 2.0,
  auto_trading_enabled boolean DEFAULT false,
  auto_trading_hours_start time DEFAULT '00:00:00',
  auto_trading_hours_end time DEFAULT '23:59:59',
  min_confidence_threshold integer DEFAULT 75 CHECK (min_confidence_threshold >= 0 AND min_confidence_threshold <= 100),
  allow_ai_override boolean DEFAULT true,
  allow_hybrid_strategy boolean DEFAULT true,
  notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_user_id ON ai_trade_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_created_at ON ai_trade_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_decision_type ON ai_trade_decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_executed ON ai_trade_decisions(executed);

CREATE INDEX IF NOT EXISTS idx_trade_options_user_id ON trade_options(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_options_decision_id ON trade_options(decision_id);
CREATE INDEX IF NOT EXISTS idx_trade_options_selected ON trade_options(selected);

CREATE INDEX IF NOT EXISTS idx_auto_trading_status_user_id ON auto_trading_status(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_enabled ON auto_trading_status(enabled);

CREATE INDEX IF NOT EXISTS idx_strategy_comparison_user_id ON strategy_comparison(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_comparison_created_at ON strategy_comparison(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_learning_metrics_user_id ON ai_learning_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_learning_metrics_trade_id ON ai_learning_metrics(trade_id);

CREATE INDEX IF NOT EXISTS idx_user_trading_preferences_user_id ON user_trading_preferences(user_id);

-- Enable Row Level Security
ALTER TABLE ai_trade_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_trading_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_comparison ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trading_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_trade_decisions
CREATE POLICY "Users can view own AI trade decisions"
  ON ai_trade_decisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own AI trade decisions"
  ON ai_trade_decisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI trade decisions"
  ON ai_trade_decisions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for trade_options
CREATE POLICY "Users can view own trade options"
  ON trade_options FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trade options"
  ON trade_options FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trade options"
  ON trade_options FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for auto_trading_status
CREATE POLICY "Users can view own auto trading status"
  ON auto_trading_status FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own auto trading status"
  ON auto_trading_status FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto trading status"
  ON auto_trading_status FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for strategy_comparison
CREATE POLICY "Users can view own strategy comparisons"
  ON strategy_comparison FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own strategy comparisons"
  ON strategy_comparison FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for ai_learning_metrics
CREATE POLICY "Users can view own AI learning metrics"
  ON ai_learning_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own AI learning metrics"
  ON ai_learning_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_trading_preferences
CREATE POLICY "Users can view own trading preferences"
  ON user_trading_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trading preferences"
  ON user_trading_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trading preferences"
  ON user_trading_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to reset daily trade count at midnight
CREATE OR REPLACE FUNCTION reset_daily_auto_trading_counts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE auto_trading_status
  SET
    trades_taken_today = 0,
    daily_pnl = 0,
    consecutive_no_opportunity_count = 0,
    emergency_stop = false,
    updated_at = now()
  WHERE enabled = true;
END;
$$;

-- Function to update auto trading status timestamp
CREATE OR REPLACE FUNCTION update_auto_trading_status_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_auto_trading_status_timestamp
  BEFORE UPDATE ON auto_trading_status
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_trading_status_timestamp();

-- Function to update user trading preferences timestamp
CREATE OR REPLACE FUNCTION update_user_trading_preferences_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_user_trading_preferences_timestamp
  BEFORE UPDATE ON user_trading_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_trading_preferences_timestamp();
