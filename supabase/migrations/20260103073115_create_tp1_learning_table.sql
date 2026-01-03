/*
  # TP1 Learning System Table

  1. New Table: tp1_learning_log
    - Tracks all TP1 hit events and outcomes
    - Used by Alpha to learn optimal TP1 placement
    - Records user decisions and final outcomes

  2. Purpose:
    - Track TP1 hit rate by market conditions
    - Learn when continuing to TP2 is profitable vs risky
    - Calibrate TP1 confidence scores over time
    - Understand user behavior patterns

  3. Security:
    - RLS enabled
    - Users can only view their own logs
*/

-- Create TP1 learning log table
CREATE TABLE IF NOT EXISTS tp1_learning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  tp1_price numeric NOT NULL,
  tp2_price numeric NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric,
  current_price_at_tp1 numeric NOT NULL,
  pnl_at_tp1 numeric NOT NULL,
  
  -- Alpha's recommendation when TP1 hit
  alpha_recommendation text NOT NULL CHECK (alpha_recommendation IN ('CLOSE_NOW', 'CONTINUE_TO_TP2')),
  alpha_confidence numeric NOT NULL CHECK (alpha_confidence >= 0 AND alpha_confidence <= 100),
  alpha_reasoning text,
  
  -- User's decision
  user_decision text CHECK (user_decision IS NULL OR user_decision IN ('continued', 'closed_early')),
  decision_time timestamptz,
  
  -- Final outcome (filled when trade closes)
  final_outcome text CHECK (final_outcome IS NULL OR final_outcome IN ('tp2_hit', 'stopped_out', 'manual_close', 'timeout')),
  final_pnl numeric,
  max_profit_after_tp1 numeric,
  
  -- Market conditions at TP1 hit
  market_conditions jsonb DEFAULT '{}'::jsonb,
  
  created_at timestamptz DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tp1_learning_user_symbol
  ON tp1_learning_log(user_id, symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tp1_learning_outcome
  ON tp1_learning_log(final_outcome, alpha_recommendation)
  WHERE final_outcome IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tp1_learning_recent
  ON tp1_learning_log(created_at DESC);

-- Enable RLS
ALTER TABLE tp1_learning_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own TP1 learning logs"
  ON tp1_learning_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert TP1 learning logs"
  ON tp1_learning_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update TP1 learning logs"
  ON tp1_learning_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE tp1_learning_log IS 'Tracks all TP1 hit events and outcomes for Alpha learning system';
COMMENT ON COLUMN tp1_learning_log.alpha_recommendation IS 'Alpha real-time recommendation when TP1 was hit';
COMMENT ON COLUMN tp1_learning_log.user_decision IS 'What the user chose to do (continued or closed_early)';
COMMENT ON COLUMN tp1_learning_log.final_outcome IS 'Final outcome of the trade after TP1 was hit';
COMMENT ON COLUMN tp1_learning_log.max_profit_after_tp1 IS 'Highest profit reached after TP1 (for counterfactual analysis)';
