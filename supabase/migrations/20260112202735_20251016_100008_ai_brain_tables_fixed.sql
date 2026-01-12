/*
  # AI Trading Brain Tables - Fixed

  1. Tables
    - ai_trade_decisions
    - trade_options (3 risk variants)
    - strategy_comparison
    - ai_learning_metrics

  2. Indexes
    - Performance indexes for AI brain queries
*/

-- AI Trade Decisions Table
CREATE TABLE IF NOT EXISTS ai_trade_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
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
  executed_at timestamptz
);

-- Trade Options Table (3 risk variants)
CREATE TABLE IF NOT EXISTS trade_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
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

-- Strategy Comparison Table
CREATE TABLE IF NOT EXISTS strategy_comparison (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
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
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trade_records(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES ai_trade_decisions(id) ON DELETE CASCADE,
  strategy_used text NOT NULL,
  predicted_confidence integer NOT NULL,
  actual_outcome text NOT NULL CHECK (actual_outcome IN ('win', 'loss', 'breakeven', 'pending')),
  predicted_pnl numeric,
  actual_pnl numeric,
  accuracy_score numeric,
  market_conditions jsonb NOT NULL,
  indicators_used jsonb NOT NULL,
  lessons_learned text,
  created_at timestamptz DEFAULT now()
);

-- AI Trade Decisions Indexes
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_user_id ON ai_trade_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_created_at ON ai_trade_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_decision_type ON ai_trade_decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_executed ON ai_trade_decisions(executed);

-- Trade Options Indexes
CREATE INDEX IF NOT EXISTS idx_trade_options_user_id ON trade_options(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_options_decision_id ON trade_options(decision_id);
CREATE INDEX IF NOT EXISTS idx_trade_options_selected ON trade_options(selected);

-- Strategy Comparison Indexes
CREATE INDEX IF NOT EXISTS idx_strategy_comparison_user_id ON strategy_comparison(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_comparison_created_at ON strategy_comparison(created_at DESC);

-- AI Learning Metrics Indexes
CREATE INDEX IF NOT EXISTS idx_ai_learning_metrics_user_id ON ai_learning_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_learning_metrics_trade_id ON ai_learning_metrics(trade_id);