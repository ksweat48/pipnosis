/*
  # Add AI Learning Columns to goal_session_trades

  ## Changes
  1. Add `ai_analyzed` flag to prevent duplicate learning
  2. Add `risk_weight` to weight learning based on session difficulty
  3. Add index for efficient learning queries

  ## Rationale
  - AI learning system needs to track which trades have been analyzed
  - Different risk modes (conservative/balanced/aggressive) should contribute different skill weights
  - Prevents re-analyzing the same trade multiple times
*/

-- Add ai_analyzed flag
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'ai_analyzed'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN ai_analyzed BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add risk_weight column (derived from goal session's risk_mode)
-- conservative = 0.7x, balanced = 1.0x, aggressive = 1.3x
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'risk_weight'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN risk_weight NUMERIC DEFAULT 1.0;
  END IF;
END $$;

-- Create index for unanalyzed closed trades (for learning trigger)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_learning_queue
  ON goal_session_trades(user_id, closed_at DESC)
  WHERE status = 'closed' AND ai_analyzed = false;

-- Create function to auto-populate risk_weight from goal_session
CREATE OR REPLACE FUNCTION set_trade_risk_weight()
RETURNS TRIGGER AS $$
DECLARE
  session_risk_mode text;
BEGIN
  -- Get the risk mode from the parent goal session
  SELECT risk_mode INTO session_risk_mode
  FROM goal_sessions
  WHERE id = NEW.goal_session_id;

  -- Set weight based on risk mode
  NEW.risk_weight := CASE
    WHEN session_risk_mode = 'low' THEN 0.7
    WHEN session_risk_mode = 'medium' THEN 1.0
    WHEN session_risk_mode = 'high' THEN 1.3
    ELSE 1.0
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-set risk_weight
DROP TRIGGER IF EXISTS trigger_set_trade_risk_weight ON goal_session_trades;
CREATE TRIGGER trigger_set_trade_risk_weight
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION set_trade_risk_weight();

-- Backfill risk_weight for existing trades
UPDATE goal_session_trades t
SET risk_weight = CASE
  WHEN gs.risk_mode = 'low' THEN 0.7
  WHEN gs.risk_mode = 'medium' THEN 1.0
  WHEN gs.risk_mode = 'high' THEN 1.3
  ELSE 1.0
END
FROM goal_sessions gs
WHERE t.goal_session_id = gs.id
  AND t.risk_weight IS NULL;

COMMENT ON COLUMN goal_session_trades.ai_analyzed IS
'Tracks whether AI learning has analyzed this trade. Prevents duplicate learning.';

COMMENT ON COLUMN goal_session_trades.risk_weight IS
'Learning weight multiplier based on session difficulty: conservative=0.7x, balanced=1.0x, aggressive=1.3x';
