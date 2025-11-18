/*
  # Event-Based LLM Backtest System

  1. New Tables
    - `event_based_backtest_sessions`
      - Stores summary data from event-based LLM backtests
      - Tracks triggers detected, LLM calls made, and trading performance
      - One row per backtest session

  2. Security
    - Enable RLS on `event_based_backtest_sessions` table
    - Add policies for authenticated users to manage their own sessions

  3. Features
    - Captures trigger detection statistics
    - Records LLM evaluation metrics (calls, tokens, cost)
    - Stores compressed trade summaries
    - Tracks trigger-to-trade conversion ratio
*/

-- Create event_based_backtest_sessions table
CREATE TABLE IF NOT EXISTS event_based_backtest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  duration_seconds integer NOT NULL,

  -- Configuration
  symbol text NOT NULL,
  timeframe text NOT NULL,
  risk_mode text NOT NULL,
  initial_balance numeric NOT NULL DEFAULT 10000,
  used_llm boolean NOT NULL DEFAULT true,

  -- Processing Statistics
  candles_processed integer NOT NULL DEFAULT 0,
  triggers_detected integer NOT NULL DEFAULT 0,
  trigger_types jsonb,

  -- LLM Metrics
  llm_calls_made integer NOT NULL DEFAULT 0,
  llm_tokens_used integer NOT NULL DEFAULT 0,
  llm_cost_estimate numeric NOT NULL DEFAULT 0,

  -- Trading Performance
  trades_executed integer NOT NULL DEFAULT 0,
  trades_won integer NOT NULL DEFAULT 0,
  trades_lost integer NOT NULL DEFAULT 0,
  trades_breakeven integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  total_pnl numeric NOT NULL DEFAULT 0,
  final_balance numeric NOT NULL DEFAULT 10000,
  avg_win numeric NOT NULL DEFAULT 0,
  avg_loss numeric NOT NULL DEFAULT 0,
  profit_factor numeric NOT NULL DEFAULT 0,
  max_drawdown numeric NOT NULL DEFAULT 0,
  avg_hold_time_minutes numeric NOT NULL DEFAULT 0,

  -- Efficiency Metrics
  trigger_to_trade_ratio numeric NOT NULL DEFAULT 0,

  -- Compressed Data
  trades_summary jsonb,
  trigger_distribution jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_backtest_user_id ON event_based_backtest_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_event_backtest_end_time ON event_based_backtest_sessions(end_time DESC);
CREATE INDEX IF NOT EXISTS idx_event_backtest_symbol ON event_based_backtest_sessions(symbol);
CREATE INDEX IF NOT EXISTS idx_event_backtest_win_rate ON event_based_backtest_sessions(win_rate DESC);

-- Enable Row Level Security
ALTER TABLE event_based_backtest_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own sessions
CREATE POLICY "Users can view own event backtest sessions"
  ON event_based_backtest_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own sessions
CREATE POLICY "Users can create own event backtest sessions"
  ON event_based_backtest_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own sessions
CREATE POLICY "Users can update own event backtest sessions"
  ON event_based_backtest_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own sessions
CREATE POLICY "Users can delete own event backtest sessions"
  ON event_based_backtest_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_event_backtest_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_event_backtest_updated_at ON event_based_backtest_sessions;
CREATE TRIGGER trigger_update_event_backtest_updated_at
  BEFORE UPDATE ON event_based_backtest_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_event_backtest_updated_at();

-- Add helpful comment
COMMENT ON TABLE event_based_backtest_sessions IS 'Stores results from event-based LLM backtests where Flow V2 detects triggers and LLM evaluates trade decisions';
