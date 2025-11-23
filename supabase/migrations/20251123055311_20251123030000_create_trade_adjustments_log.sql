/*
  # Create Trade Adjustments Log Table

  1. New Tables
    - `trade_adjustments_log`
      - Tracks real-time trade management decisions
      - Records trailing stops, partial exits, stop adjustments
      - Links to trades and sessions
      - Stores LLM reasoning for each adjustment

  2. Security
    - Enable RLS on `trade_adjustments_log` table
    - Add policies for authenticated users to read/write their own adjustments
*/

CREATE TABLE IF NOT EXISTS trade_adjustments_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  session_id uuid,
  trading_mode text NOT NULL CHECK (trading_mode IN ('backtest', 'live_demo', 'smart_goal')),

  adjustment_type text NOT NULL CHECK (adjustment_type IN (
    'trailing_stop',
    'partial_exit',
    'move_sl_to_breakeven',
    'extend_tp',
    'tighten_sl',
    'early_exit'
  )),

  original_stop_loss numeric,
  new_stop_loss numeric,
  original_take_profit numeric,
  new_take_profit numeric,

  partial_close_percent numeric CHECK (partial_close_percent >= 0 AND partial_close_percent <= 100),
  trailing_distance numeric,

  current_price numeric NOT NULL,
  unrealized_pnl numeric,

  adjustment_reason text NOT NULL,
  llm_confidence numeric CHECK (llm_confidence >= 0 AND llm_confidence <= 100),

  market_conditions jsonb,

  outcome_impact numeric,
  was_beneficial boolean,

  adjustment_time timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_trade_adjustments_user_id ON trade_adjustments_log(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_adjustments_trade_id ON trade_adjustments_log(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_adjustments_session_id ON trade_adjustments_log(session_id);
CREATE INDEX IF NOT EXISTS idx_trade_adjustments_type ON trade_adjustments_log(adjustment_type);
CREATE INDEX IF NOT EXISTS idx_trade_adjustments_time ON trade_adjustments_log(adjustment_time DESC);
CREATE INDEX IF NOT EXISTS idx_trade_adjustments_mode ON trade_adjustments_log(trading_mode);

-- Enable Row Level Security
ALTER TABLE trade_adjustments_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own adjustments
CREATE POLICY "Users can view own trade adjustments"
  ON trade_adjustments_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own adjustments
CREATE POLICY "Users can insert own trade adjustments"
  ON trade_adjustments_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own adjustments
CREATE POLICY "Users can update own trade adjustments"
  ON trade_adjustments_log
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add column to llm_pipeline_execution_log for profit maximization tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'profit_maximization_active'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN profit_maximization_active boolean DEFAULT true,
    ADD COLUMN trade_adjustments_made integer DEFAULT 0;
  END IF;
END $$;

-- Add trading_mode column to llm_layer_decision_log if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_layer_decision_log'
    AND column_name = 'trading_mode'
  ) THEN
    ALTER TABLE llm_layer_decision_log
    ADD COLUMN trading_mode text CHECK (trading_mode IN ('backtest', 'live_demo', 'smart_goal')),
    ADD COLUMN is_trade_adjustment boolean DEFAULT false;
  END IF;
END $$;

-- Add trading_mode column to llm_pipeline_execution_log if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'trading_mode'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN trading_mode text CHECK (trading_mode IN ('backtest', 'live_demo', 'smart_goal'));
  END IF;
END $$;