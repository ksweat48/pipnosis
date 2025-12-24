/*
  # Add Critical Level Tracking to Trades

  1. Changes to goal_session_trades
    - Add `critical_levels` JSONB column to store detected support/resistance levels
    - Add `watched_level` JSONB column to store the prioritized level Alpha is watching
    - Add `early_exit_level` numeric column for pre-calculated early exit price

  2. Purpose
    - Enable Alpha to track and reference critical price levels during trades
    - Store S/R levels, urgency scores, and actionable advice
    - Pre-calculate early exit levels to protect against rejection zones
    - Persist level data for post-trade analysis and learning

  3. Example Data Structure
    critical_levels: [
      {
        "price": 1.08450,
        "type": "resistance",
        "strength": 0.85,
        "touches": 4,
        "reason": "Strong rejection zone"
      }
    ]

    watched_level: {
      "price": 1.08450,
      "type": "resistance",
      "distance": 12.5,
      "urgency": 85,
      "actionable": "CRITICAL: resistance only 12.5 pips away..."
    }

  4. View Update
    - Recreate goal_trades view to include new columns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'critical_levels'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN critical_levels JSONB DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'watched_level'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN watched_level JSONB DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'early_exit_level'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN early_exit_level NUMERIC(10, 5) DEFAULT NULL;
  END IF;
END $$;

COMMENT ON COLUMN goal_session_trades.critical_levels IS 'Array of all detected critical S/R levels for this trade';
COMMENT ON COLUMN goal_session_trades.watched_level IS 'The single most important level Alpha is monitoring (prioritized from critical_levels)';
COMMENT ON COLUMN goal_session_trades.early_exit_level IS 'Pre-calculated price to exit before hitting watched level (if applicable)';

CREATE OR REPLACE VIEW goal_trades AS
SELECT 
  id,
  goal_session_id,
  trade_id,
  user_id,
  symbol,
  direction,
  entry_price,
  exit_price,
  stop_loss,
  take_profit,
  position_size,
  lot_size,
  profit_loss,
  profit_loss AS realized_pnl,
  profit_loss AS pnl_result,
  status,
  opened_at,
  closed_at,
  created_at,
  updated_at,
  close_reason,
  ai_confidence,
  ai_reasoning,
  ai_strategy_used,
  ai_analyzed,
  ai_validated,
  risk_weight,
  current_price,
  current_pnl,
  order_type,
  limit_price,
  position_type,
  mid_trade_llm_actions,
  llm_interventions_count,
  playbook_id,
  regime_bucket,
  risk_dollars,
  goal_met_at,
  goal_met_price,
  expected_profit_at_entry,
  unrealized_goal_achievement,
  market_conditions,
  setup_type,
  confidence_score,
  max_drawdown,
  max_profit,
  total_pips,
  trade_sequence_number,
  planned_profit,
  critical_levels,
  watched_level,
  early_exit_level
FROM goal_session_trades;
