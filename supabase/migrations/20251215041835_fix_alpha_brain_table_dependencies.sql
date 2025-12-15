/*
  # Fix Alpha Brain Dashboard Dependencies

  1. Changes
    - Create goal_trades view as alias for goal_session_trades
    - Add missing AI columns to goal_session_trades
    - Ensure all columns needed by Alpha Brain services exist

  2. Purpose
    - Enable Alpha Brain dashboard to query data correctly
    - Support meta-learning and execution analysis
*/

-- Add AI confidence column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'ai_confidence'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN ai_confidence INTEGER CHECK (ai_confidence >= 0 AND ai_confidence <= 100);
  END IF;
END $$;

-- Add AI reasoning column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'ai_reasoning'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN ai_reasoning TEXT;
  END IF;
END $$;

-- Add AI strategy used column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'ai_strategy_used'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN ai_strategy_used TEXT;
  END IF;
END $$;

-- Add user_id column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
    
    -- Backfill user_id from goal_sessions
    UPDATE goal_session_trades gst
    SET user_id = gs.user_id
    FROM goal_sessions gs
    WHERE gst.goal_session_id = gs.id
    AND gst.user_id IS NULL;
  END IF;
END $$;

-- Create goal_trades view as alias for goal_session_trades
CREATE OR REPLACE VIEW goal_trades AS
SELECT
  id,
  goal_session_id,
  trade_id,
  COALESCE(user_id, (SELECT user_id FROM goal_sessions WHERE id = goal_session_trades.goal_session_id)) as user_id,
  symbol,
  direction,
  entry_price,
  exit_price,
  stop_loss,
  take_profit,
  position_size,
  position_size as lot_size,
  profit_loss,
  profit_loss as realized_pnl,
  status,
  opened_at,
  closed_at,
  created_at,
  close_reason,
  ai_confidence,
  ai_reasoning,
  ai_strategy_used,
  ai_analyzed,
  risk_weight,
  current_price,
  order_type,
  limit_price
FROM goal_session_trades;

-- Grant appropriate permissions on the view
GRANT SELECT ON goal_trades TO authenticated;
GRANT SELECT ON goal_trades TO service_role;

COMMENT ON VIEW goal_trades IS 'Convenience view that aliases goal_session_trades for backward compatibility with Alpha Brain services';
