/*
  # Consolidate to Goal-Based Trading Only

  ## Clean Slate Migration
  - Drop legacy trading tables (simulated_positions, trade_history, balance_transactions)
  - Remove demo_balance column from user_profiles
  - Drop all associated triggers and functions
  - Keep only goal_session_trades as single source of truth

  ## Rationale
  - Simplifies trading system to pure goal-based approach
  - Eliminates confusion between "manual", "demo", and "goal" modes
  - Single table = single source of truth
  - Reduces maintenance burden and prevents data inconsistencies

  ## Safety
  - User confirmed: No open positions to preserve
  - User confirmed: No historical data migration needed
  - Clean slate approach: Start fresh with goal-based only
*/

-- =====================================================
-- STEP 1: Drop all legacy trading tables
-- =====================================================

-- Drop simulated_positions table and all dependencies
DROP TABLE IF EXISTS simulated_positions CASCADE;

-- Drop trade_history table and all dependencies
DROP TABLE IF EXISTS trade_history CASCADE;

-- Drop balance_transactions table if it exists
DROP TABLE IF EXISTS balance_transactions CASCADE;

-- Drop manual_trades table if it exists
DROP TABLE IF EXISTS manual_trades CASCADE;

-- Drop demo_trades table if it exists
DROP TABLE IF EXISTS demo_trades CASCADE;

-- =====================================================
-- STEP 2: Clean up user_profiles table
-- =====================================================

-- Remove demo_balance column if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'demo_balance'
  ) THEN
    ALTER TABLE user_profiles DROP COLUMN demo_balance;
  END IF;
END $$;

-- Ensure account_balance has proper default
DO $$
BEGIN
  ALTER TABLE user_profiles
    ALTER COLUMN account_balance SET DEFAULT 10000;
EXCEPTION
  WHEN undefined_column THEN
    -- Column doesn't exist, create it
    ALTER TABLE user_profiles
      ADD COLUMN account_balance DECIMAL(15,2) DEFAULT 10000 NOT NULL;
END $$;

-- =====================================================
-- STEP 3: Verify goal_session_trades is complete
-- =====================================================

-- Ensure all critical columns exist on goal_session_trades
DO $$
BEGIN
  -- Add missing columns if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'current_pnl'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN current_pnl DECIMAL(15,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'current_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN current_price DECIMAL(15,5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'exit_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN exit_price DECIMAL(15,5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'profit_loss'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN profit_loss DECIMAL(15,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'close_reason'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN close_reason TEXT;
  END IF;
END $$;

-- =====================================================
-- STEP 4: Create helpful indexes if missing
-- =====================================================

-- Index for querying open trades by user
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_status
  ON goal_session_trades(user_id, status);

-- Index for querying trades by goal session
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_session_status
  ON goal_session_trades(goal_session_id, status);

-- Index for historical queries
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_closed_at
  ON goal_session_trades(user_id, closed_at DESC)
  WHERE status = 'closed';

-- =====================================================
-- STEP 5: Add migration record
-- =====================================================

COMMENT ON TABLE goal_session_trades IS
'Single source of truth for all trading. Every trade is a goal trade. No manual, demo, or simulated modes exist.';

-- =====================================================
-- SUCCESS
-- =====================================================

-- Log the consolidation
DO $$
BEGIN
  RAISE NOTICE 'Consolidation complete: All trading now uses goal_session_trades only';
  RAISE NOTICE 'Dropped tables: simulated_positions, trade_history, balance_transactions';
  RAISE NOTICE 'Single source of truth: goal_session_trades';
END $$;
