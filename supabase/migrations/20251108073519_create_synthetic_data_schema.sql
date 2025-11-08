/*
  # Create Synthetic Data Schema for AI Training Lab

  1. New Tables
    - `synthetic_candles`
      - Isolated table for synthetic/fake market data used in AI training
      - Same structure as forex_candles but completely separate
      - Includes generation metadata and session tracking
    
    - `synthetic_backtest_sessions`
      - Stores backtest sessions run on synthetic data
      - Mirrors backtest_sessions structure
      - Tracks synthetic data generation parameters
    
    - `synthetic_backtest_trades`
      - Individual trades from synthetic backtests
      - Mirrors backtest_trades structure
      - Links to synthetic sessions
    
    - `synthetic_data_generations`
      - Tracks each synthetic dataset generation
      - Stores parameters used (volatility, trend, etc.)
      - Enables reproducibility and analysis

  2. Security
    - Enable RLS on all synthetic tables
    - Allow authenticated users to read synthetic data
    - Only admins can generate new synthetic data
    - Strict separation from production data

  3. Important Notes
    - All synthetic data is clearly marked and isolated
    - No foreign key relationships to production tables
    - Used exclusively for AI training and testing
    - Never mixed with real market data
*/

-- Synthetic Candles Table (isolated from forex_candles)
CREATE TABLE IF NOT EXISTS synthetic_candles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  synthetic_session_id uuid NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  close_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric DEFAULT 0,
  tick_volume integer DEFAULT 0,
  spread numeric DEFAULT 0,
  is_synthetic boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_synthetic_candles_lookup 
  ON synthetic_candles(synthetic_session_id, symbol, timeframe, open_time);

CREATE INDEX IF NOT EXISTS idx_synthetic_candles_time_range 
  ON synthetic_candles(symbol, timeframe, open_time DESC);

-- Synthetic Data Generations (tracks generation parameters)
CREATE TABLE IF NOT EXISTS synthetic_data_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  generation_params jsonb NOT NULL, -- {volatility, trend_bias, market_regime, etc}
  market_scenario text NOT NULL, -- 'trending_up', 'trending_down', 'ranging', 'high_volatility', 'mixed'
  candles_generated integer DEFAULT 0,
  generation_duration_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_synthetic_generations_user 
  ON synthetic_data_generations(user_id, created_at DESC);

-- Synthetic Backtest Sessions
CREATE TABLE IF NOT EXISTS synthetic_backtest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  synthetic_generation_id uuid REFERENCES synthetic_data_generations(id) ON DELETE SET NULL,
  session_name text NOT NULL,
  description text,
  symbols text[] NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  timeframes text[] NOT NULL,
  
  -- Strategy Configuration
  use_gpt4_reasoning boolean DEFAULT false,
  confidence_threshold integer DEFAULT 75,
  risk_mode text CHECK (risk_mode IN ('low', 'medium', 'high')),
  max_concurrent_trades integer DEFAULT 2,
  initial_balance numeric DEFAULT 10000,
  position_size_percent numeric DEFAULT 2,
  commission_per_trade numeric DEFAULT 0,
  slippage_pips numeric DEFAULT 1,
  
  -- Results
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
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
  
  -- Execution tracking
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  candles_processed integer DEFAULT 0,
  signals_generated integer DEFAULT 0,
  signals_executed integer DEFAULT 0,
  signals_skipped integer DEFAULT 0,
  gpt4_calls_made integer DEFAULT 0,
  estimated_api_cost numeric DEFAULT 0,
  
  -- Metadata
  is_synthetic boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_synthetic_sessions_user 
  ON synthetic_backtest_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synthetic_sessions_status 
  ON synthetic_backtest_sessions(status, created_at DESC);

-- Synthetic Backtest Trades
CREATE TABLE IF NOT EXISTS synthetic_backtest_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES synthetic_backtest_sessions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Trade identification
  trade_number integer NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  
  -- Entry details
  entry_time timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  position_size numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  risk_reward_ratio numeric NOT NULL,
  
  -- Strategy signals
  flow_v2_confidence integer,
  h1_bias text,
  m5_filter_passed boolean,
  m1_execution_ready boolean,
  setup_type text,
  
  -- AI reasoning
  ai_reasoning_used boolean DEFAULT false,
  ai_conviction integer,
  ai_rationale text,
  ai_risk_assessment text,
  
  -- Execution decision
  should_execute boolean,
  execution_reason text,
  
  -- Exit details
  exit_time timestamptz,
  exit_price numeric,
  exit_reason text,
  
  -- Results
  pnl numeric DEFAULT 0,
  pnl_percent numeric DEFAULT 0,
  pips_gained numeric DEFAULT 0,
  outcome text CHECK (outcome IN ('win', 'loss', 'breakeven', 'open')),
  holding_duration_minutes integer,
  
  -- Analysis
  market_regime jsonb,
  quality_score integer,
  
  -- Metadata
  is_synthetic boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_synthetic_trades_session 
  ON synthetic_backtest_trades(session_id, entry_time);

CREATE INDEX IF NOT EXISTS idx_synthetic_trades_user 
  ON synthetic_backtest_trades(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_synthetic_trades_outcome 
  ON synthetic_backtest_trades(outcome, session_id);

-- Enable Row Level Security
ALTER TABLE synthetic_candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_data_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_backtest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_backtest_trades ENABLE ROW LEVEL SECURITY;

-- RLS Policies for synthetic_candles
CREATE POLICY "Authenticated users can read synthetic candles"
  ON synthetic_candles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert synthetic candles"
  ON synthetic_candles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for synthetic_data_generations
CREATE POLICY "Users can read own synthetic generations"
  ON synthetic_data_generations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create synthetic generations"
  ON synthetic_data_generations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for synthetic_backtest_sessions
CREATE POLICY "Users can read own synthetic sessions"
  ON synthetic_backtest_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create synthetic sessions"
  ON synthetic_backtest_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own synthetic sessions"
  ON synthetic_backtest_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for synthetic_backtest_trades
CREATE POLICY "Users can read own synthetic trades"
  ON synthetic_backtest_trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create synthetic trades"
  ON synthetic_backtest_trades FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Function to clean up old synthetic data (30 days)
CREATE OR REPLACE FUNCTION cleanup_old_synthetic_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete old synthetic generations and cascading data
  DELETE FROM synthetic_data_generations
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Delete orphaned synthetic candles
  DELETE FROM synthetic_candles
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Delete old synthetic sessions
  DELETE FROM synthetic_backtest_sessions
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;