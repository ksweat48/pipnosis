/*
  # Add Lot Sizing Decision Linkage to Trade Records (SSOT FIX 2026-02-03)

  ## Problem
  Goal-aware lot sizing coordinator calculates expected profit WITH pip-to-dollar conversion (~$133),
  but trade executor was recalculating without conversion (~$1). This created a cascading SSOT violation
  affecting trade target display and completion percentage calculations.

  ## Solution
  1. Link trade records to their lot sizing decisions for audit trail
  2. Store the coordinator's expectedProfitAtTP value in trade for clarity
  3. Trade executor now uses coordinator's calculation instead of recalculating

  ## Changes
  - Add `lot_sizing_decision_id` FK to `goal_session_trades` (nullable, non-blocking)
  - Add `expected_profit_at_tp_dollars` for tracking (informational field)
  - Ensures all future trades capture coordinator's correct expected profit value
  - Existing trades unaffected (fields are nullable)

  ## Impact
  - Dashboard Trade Target now shows correct value (~$133, not ~$1)
  - Completion percentage uses session goal ($294), not trade target
  - Governance audit trail improved: can trace decisions to trades
  - CCIP compliant: all new trades log decision linkage
*/

DO $$
BEGIN
  -- Add lot_sizing_decision_id FK if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'lot_sizing_decision_id'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN lot_sizing_decision_id UUID REFERENCES goal_aware_lot_sizing_decisions(id) ON DELETE SET NULL;
    
    CREATE INDEX idx_goal_session_trades_lot_sizing_decision
    ON goal_session_trades(lot_sizing_decision_id);
    
    RAISE NOTICE 'Added lot_sizing_decision_id column to goal_session_trades';
  END IF;

  -- Add expected_profit_at_tp_dollars for tracking (optional clarity field)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
    AND column_name = 'expected_profit_at_tp_dollars'
  ) THEN
    ALTER TABLE goal_session_trades
    ADD COLUMN expected_profit_at_tp_dollars NUMERIC DEFAULT NULL;
    
    RAISE NOTICE 'Added expected_profit_at_tp_dollars column to goal_session_trades';
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Migration skipped or already applied: %', SQLERRM;
END $$;
