/*
  # Enhanced Dual-Mode Execution System

  1. New Fields Added to goal_sessions
    - planned_strategy: JSONB - Alpha's strategic plan created at session start
    - trades_planned: INTEGER - Number of trades in Alpha's plan
    - trades_completed: INTEGER - Trades finished so far in this session

  2. New Fields Added to goal_session_trades
    - trade_sequence_number: INTEGER - Order of execution in single-trade mode (1, 2, 3...)
    - planned_profit: NUMERIC - Expected profit target for this trade from Alpha's plan

  3. Indexes
    - Index on trade_sequence_number for ordering in single-trade mode

  4. Security
    - RLS policies already exist and will apply to new fields
    - New fields are user-specific and protected

  ## Notes
  - Existing fields already support dual-mode: multi_trade_enabled, awaiting_user_continuation
  - This migration adds strategic planning capabilities to both modes
*/

-- Add strategic planning fields to goal_sessions
DO $$
BEGIN
  -- Alpha's strategic plan (JSON structure with trades array, risk assessment, etc)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'planned_strategy'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN planned_strategy JSONB;
    COMMENT ON COLUMN goal_sessions.planned_strategy IS
      'Alpha''s strategic plan created at session start, includes trade breakdown and reasoning';
  END IF;

  -- Number of trades Alpha plans to execute
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'trades_planned'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN trades_planned INTEGER DEFAULT 1;
    COMMENT ON COLUMN goal_sessions.trades_planned IS
      'Number of trades in Alpha''s strategic plan';
  END IF;

  -- Trades completed so far (different from trades_in_session which is legacy)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'trades_completed'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN trades_completed INTEGER DEFAULT 0;
    COMMENT ON COLUMN goal_sessions.trades_completed IS
      'Number of trades that have closed in this session';
  END IF;
END $$;

-- Add trade sequencing and planning to goal_session_trades
DO $$
BEGIN
  -- Sequence number for single-trade mode execution order
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'trade_sequence_number'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN trade_sequence_number INTEGER;
    COMMENT ON COLUMN goal_session_trades.trade_sequence_number IS
      'Order of execution in single-trade mode (1, 2, 3...). NULL for multi-trade mode.';
  END IF;

  -- Planned profit from Alpha's strategy
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'planned_profit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN planned_profit NUMERIC(15,2);
    COMMENT ON COLUMN goal_session_trades.planned_profit IS
      'Expected profit target for this trade from Alpha''s strategic plan';
  END IF;
END $$;

-- Create index for trade sequencing (helps with ordering queries)
CREATE INDEX IF NOT EXISTS idx_goal_trades_sequence
  ON goal_session_trades(goal_session_id, trade_sequence_number);

-- Create index for planning queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_planned_strategy
  ON goal_sessions(id) WHERE planned_strategy IS NOT NULL;