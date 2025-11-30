/*
  # Fix Playbook Tracking Columns

  ## Summary
  Adds critical columns to trade tables to enable the Deep Strategy Memory + Playbook learning system.
  Without these columns, trades cannot be linked to playbooks and performance metrics cannot be calculated.

  ## Changes
  
  ### simulated_positions table
  - Add `playbook_id` (uuid) - Links trade to the active playbook variant used
  - Add `regime_bucket` (text) - Stores market regime classification at trade entry
  - Add `risk_dollars` (numeric) - Stores dollar risk amount for R-normalized metrics
  
  ### goal_session_trades table
  - Add `playbook_id` (uuid) - Links trade to the active playbook variant used
  - Add `regime_bucket` (text) - Stores market regime classification at trade entry
  - Add `risk_dollars` (numeric) - Stores dollar risk amount for R-normalized metrics

  ## Impact
  - Enables playbook learning feedback loop
  - Allows calculation of R-normalized performance metrics (pnl_r, realized_rr)
  - Enables context-aware strategy evolution per regime bucket
  - Required for auto-promotion system to function

  ## Notes
  - Columns are nullable to support existing trades
  - New trades will populate these columns automatically
  - Foreign key constraint links to strategy_playbook table
*/

-- Add playbook tracking columns to simulated_positions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'simulated_positions' AND column_name = 'playbook_id'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN playbook_id uuid REFERENCES strategy_playbook(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'simulated_positions' AND column_name = 'regime_bucket'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN regime_bucket text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'simulated_positions' AND column_name = 'risk_dollars'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN risk_dollars numeric(12,2);
  END IF;
END $$;

-- Add playbook tracking columns to goal_session_trades
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_session_trades' AND column_name = 'playbook_id'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN playbook_id uuid REFERENCES strategy_playbook(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_session_trades' AND column_name = 'regime_bucket'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN regime_bucket text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_session_trades' AND column_name = 'risk_dollars'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN risk_dollars numeric(12,2);
  END IF;
END $$;

-- Create indexes for efficient playbook queries
CREATE INDEX IF NOT EXISTS idx_simulated_positions_playbook_id 
ON simulated_positions(playbook_id) WHERE playbook_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_simulated_positions_regime_bucket 
ON simulated_positions(regime_bucket) WHERE regime_bucket IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_playbook_id 
ON goal_session_trades(playbook_id) WHERE playbook_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_regime_bucket 
ON goal_session_trades(regime_bucket) WHERE regime_bucket IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN simulated_positions.playbook_id IS 'Links trade to the active playbook variant used for this trade';
COMMENT ON COLUMN simulated_positions.regime_bucket IS 'Market regime classification at trade entry (e.g., "trend_high_vol")';
COMMENT ON COLUMN simulated_positions.risk_dollars IS 'Dollar risk amount for calculating R-normalized metrics';

COMMENT ON COLUMN goal_session_trades.playbook_id IS 'Links trade to the active playbook variant used for this trade';
COMMENT ON COLUMN goal_session_trades.regime_bucket IS 'Market regime classification at trade entry (e.g., "trend_high_vol")';
COMMENT ON COLUMN goal_session_trades.risk_dollars IS 'Dollar risk amount for calculating R-normalized metrics';
