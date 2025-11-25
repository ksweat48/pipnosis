/*
  # Mid-Trade LLM Evaluation System

  1. New Tables
    - `mid_trade_llm_evaluations`
      - Stores all LLM intervention decisions during active trades
      - Links to goal_session_trades for full trade history
      - Tracks trigger events, recommendations, and actions taken
      - Monitors costs and performance metrics

  2. Security
    - Enable RLS on `mid_trade_llm_evaluations` table
    - Users can read their own evaluations
    - System can write evaluations

  3. Indexes
    - Fast lookup by trade_id
    - Fast lookup by goal_session_id
    - Chronological ordering by created_at
    - Cost analysis by date
*/

-- Create mid_trade_llm_evaluations table
CREATE TABLE IF NOT EXISTS mid_trade_llm_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL,
  goal_session_id UUID REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Trigger information
  trigger_event TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  trigger_confidence INTEGER,

  -- Market snapshot at evaluation time
  market_snapshot JSONB NOT NULL,
  trade_context JSONB NOT NULL,

  -- LLM decision
  llm_recommendation TEXT NOT NULL,
  llm_confidence INTEGER NOT NULL CHECK (llm_confidence >= 0 AND llm_confidence <= 100),
  llm_reasoning TEXT NOT NULL,
  llm_model TEXT DEFAULT 'gpt-4o-mini',

  -- Action taken
  action_taken TEXT NOT NULL,
  action_result JSONB,
  rule_violations TEXT[],

  -- Cost tracking
  cost_usd DECIMAL(10, 6),
  processing_time_ms INTEGER,
  tokens_used INTEGER,

  -- Outcome tracking
  was_correct BOOLEAN,
  impact_on_pnl DECIMAL(10, 2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_mid_trade_eval_trade_id ON mid_trade_llm_evaluations(trade_id);
CREATE INDEX IF NOT EXISTS idx_mid_trade_eval_session_id ON mid_trade_llm_evaluations(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_mid_trade_eval_user_id ON mid_trade_llm_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_mid_trade_eval_created_at ON mid_trade_llm_evaluations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mid_trade_eval_trigger_event ON mid_trade_llm_evaluations(trigger_event);
CREATE INDEX IF NOT EXISTS idx_mid_trade_eval_recommendation ON mid_trade_llm_evaluations(llm_recommendation);

-- Add column to goal_session_trades to track mid-trade actions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'mid_trade_llm_actions'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN mid_trade_llm_actions JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add column to track if trade received any LLM interventions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'llm_interventions_count'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN llm_interventions_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE mid_trade_llm_evaluations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read their own mid-trade evaluations"
  ON mid_trade_llm_evaluations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert mid-trade evaluations"
  ON mid_trade_llm_evaluations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mid-trade evaluations"
  ON mid_trade_llm_evaluations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create function to get mid-trade evaluation stats for a session
CREATE OR REPLACE FUNCTION get_mid_trade_evaluation_stats(session_id UUID)
RETURNS TABLE (
  total_evaluations INTEGER,
  total_cost_usd DECIMAL,
  recommendations_applied INTEGER,
  recommendations_rejected INTEGER,
  avg_confidence INTEGER,
  most_common_trigger TEXT,
  avg_processing_time_ms INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_evaluations,
    COALESCE(SUM(cost_usd), 0) as total_cost_usd,
    COUNT(*) FILTER (WHERE action_taken = 'applied')::INTEGER as recommendations_applied,
    COUNT(*) FILTER (WHERE action_taken = 'rejected')::INTEGER as recommendations_rejected,
    COALESCE(AVG(llm_confidence)::INTEGER, 0) as avg_confidence,
    MODE() WITHIN GROUP (ORDER BY trigger_event) as most_common_trigger,
    COALESCE(AVG(processing_time_ms)::INTEGER, 0) as avg_processing_time_ms
  FROM mid_trade_llm_evaluations
  WHERE goal_session_id = session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get all evaluations for a specific trade
CREATE OR REPLACE FUNCTION get_trade_evaluation_history(p_trade_id UUID)
RETURNS TABLE (
  id UUID,
  trigger_event TEXT,
  trigger_reason TEXT,
  llm_recommendation TEXT,
  llm_confidence INTEGER,
  llm_reasoning TEXT,
  action_taken TEXT,
  action_result JSONB,
  cost_usd DECIMAL,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.trigger_event,
    e.trigger_reason,
    e.llm_recommendation,
    e.llm_confidence,
    e.llm_reasoning,
    e.action_taken,
    e.action_result,
    e.cost_usd,
    e.created_at
  FROM mid_trade_llm_evaluations e
  WHERE e.trade_id = p_trade_id
  ORDER BY e.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for recent mid-trade evaluations with full context
CREATE OR REPLACE VIEW recent_mid_trade_evaluations AS
SELECT
  e.*,
  t.symbol,
  t.direction,
  t.entry_price,
  t.profit_loss as final_pnl,
  t.status as trade_status,
  s.target_value,
  s.status as session_status
FROM mid_trade_llm_evaluations e
LEFT JOIN goal_session_trades t ON e.trade_id = t.id
LEFT JOIN goal_sessions s ON e.goal_session_id = s.id
ORDER BY e.created_at DESC
LIMIT 100;

-- Grant permissions
GRANT SELECT ON recent_mid_trade_evaluations TO authenticated;
GRANT EXECUTE ON FUNCTION get_mid_trade_evaluation_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_trade_evaluation_history TO authenticated;
