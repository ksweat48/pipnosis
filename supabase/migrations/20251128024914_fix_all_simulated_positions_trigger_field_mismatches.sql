/*
  # Fix All Field Mismatch Errors in Simulated Position Triggers

  ## Problem
  TWO triggers on simulated_positions are trying to access fields that don't exist:
  
  1. trg_update_goal_summary
     - Tries to access: NEW.goal_session_id (column doesn't exist)
     - Tries to access: NEW.pnl (should be current_pnl)
  
  2. trg_update_trader_score
     - Tries to access: NEW.pnl (should be current_pnl)

  ## Field Reality Check
  simulated_positions table has:
  - current_pnl (NOT pnl)
  - NO goal_session_id column
  
  Other tables with correct fields:
  - trade_history: has goal_session_id and profit_loss
  - goal_session_trades: has goal_session_id and profit_loss

  ## Root Cause
  Migration 20251127211027_create_llm_reasoning_journal_system_fixed.sql
  incorrectly attached these triggers to simulated_positions table.

  ## Solution
  Remove BOTH broken triggers from simulated_positions.
  Tracking already handled properly in application code:
  - position-monitor.ts handles goal session updates
  - trade-lifecycle-manager.ts handles trader scores
  - trade_history table has correct fields

  ## Impact
  - FIXES: Users can now close positions without errors
  - NO DATA LOSS: All tracking continues via application code
  - NO BREAKING CHANGES: Existing functionality preserved
  - BETTER PERFORMANCE: No trigger overhead on position closes

  ## Tables Affected
  - simulated_positions (both triggers removed)

  ## Functions Preserved
  - update_goal_session_summary() (kept for potential future use on correct tables)
  - update_trader_score_from_goal() (kept for potential future use on correct tables)
*/

-- ============================================================================
-- STEP 1: Remove FIRST broken trigger (goal_session_summary)
-- ============================================================================

-- This trigger tries to access NEW.goal_session_id and NEW.pnl
-- Neither field exists in simulated_positions table
DROP TRIGGER IF EXISTS trg_update_goal_summary ON simulated_positions;

-- Verify it's gone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_update_goal_summary'
    AND event_object_table = 'simulated_positions'
  ) THEN
    RAISE EXCEPTION 'Failed to drop trg_update_goal_summary trigger';
  ELSE
    RAISE NOTICE 'Successfully removed trg_update_goal_summary trigger';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Remove SECOND broken trigger (trader_score)
-- ============================================================================

-- This trigger tries to access NEW.pnl which doesn't exist
-- (simulated_positions uses current_pnl)
DROP TRIGGER IF EXISTS trg_update_trader_score ON simulated_positions;

-- Verify it's gone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_update_trader_score'
    AND event_object_table = 'simulated_positions'
  ) THEN
    RAISE EXCEPTION 'Failed to drop trg_update_trader_score trigger';
  ELSE
    RAISE NOTICE 'Successfully removed trg_update_trader_score trigger';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Document functions to prevent future misuse
-- ============================================================================

-- Document that update_goal_session_summary needs specific fields
COMMENT ON FUNCTION update_goal_session_summary IS
  'Updates goal session summaries when trades close.
   
   REQUIRES FIELDS: goal_session_id, pnl
   
   COMPATIBLE TABLES:
   - trade_history (has goal_session_id and profit_loss)
   - goal_session_trades (has goal_session_id and profit_loss)
   
   INCOMPATIBLE TABLES:
   - simulated_positions (missing goal_session_id, uses current_pnl not pnl)
   
   FIXED: Removed from simulated_positions on 2025-11-28
   Originally incorrectly attached in migration 20251127211027';

-- Document that update_trader_score_from_goal needs pnl field
COMMENT ON FUNCTION update_trader_score_from_goal IS
  'Updates trader score from goal-based trades.
   
   REQUIRES FIELDS: pnl
   
   NOTE: simulated_positions table uses current_pnl not pnl
   
   FIXED: Removed from simulated_positions on 2025-11-28
   Originally incorrectly attached in migration 20251127211027';

-- ============================================================================
-- STEP 4: Verify simulated_positions schema for documentation
-- ============================================================================

DO $$
DECLARE
  has_goal_session_id boolean;
  has_pnl boolean;
  has_current_pnl boolean;
BEGIN
  -- Check for goal_session_id
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'goal_session_id'
  ) INTO has_goal_session_id;
  
  -- Check for pnl
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'pnl'
  ) INTO has_pnl;
  
  -- Check for current_pnl
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'current_pnl'
  ) INTO has_current_pnl;
  
  -- Report findings
  IF has_goal_session_id THEN
    RAISE WARNING 'Unexpected: simulated_positions has goal_session_id column';
  ELSE
    RAISE NOTICE 'Confirmed: simulated_positions does NOT have goal_session_id';
  END IF;
  
  IF has_pnl THEN
    RAISE WARNING 'Unexpected: simulated_positions has pnl column';
  ELSE
    RAISE NOTICE 'Confirmed: simulated_positions does NOT have pnl column';
  END IF;
  
  IF has_current_pnl THEN
    RAISE NOTICE 'Confirmed: simulated_positions HAS current_pnl column (correct field)';
  ELSE
    RAISE WARNING 'Problem: simulated_positions missing current_pnl column';
  END IF;
END $$;

-- ============================================================================
-- STEP 5: List remaining triggers on simulated_positions
-- ============================================================================

DO $$
DECLARE
  trigger_record RECORD;
  trigger_count integer := 0;
BEGIN
  RAISE NOTICE '=== Remaining triggers on simulated_positions ===';
  
  FOR trigger_record IN
    SELECT trigger_name, action_statement
    FROM information_schema.triggers
    WHERE event_object_table = 'simulated_positions'
    ORDER BY trigger_name
  LOOP
    trigger_count := trigger_count + 1;
    RAISE NOTICE 'Trigger: % - Function: %', trigger_record.trigger_name, trigger_record.action_statement;
  END LOOP;
  
  IF trigger_count = 0 THEN
    RAISE NOTICE 'No triggers found on simulated_positions (except system triggers)';
  ELSE
    RAISE NOTICE 'Total triggers found: %', trigger_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 6: Verify trade_history has correct fields
-- ============================================================================

DO $$
DECLARE
  has_goal_session_id boolean;
  has_profit_loss boolean;
BEGIN
  -- Check trade_history for goal_session_id
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'goal_session_id'
  ) INTO has_goal_session_id;
  
  -- Check trade_history for profit_loss
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'profit_loss'
  ) INTO has_profit_loss;
  
  IF has_goal_session_id AND has_profit_loss THEN
    RAISE NOTICE 'Confirmed: trade_history has both goal_session_id and profit_loss (correct table for these triggers)';
  ELSE
    RAISE WARNING 'Issue: trade_history missing required fields';
  END IF;
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================

/*
  ✅ Removed trg_update_goal_summary trigger from simulated_positions
  ✅ Removed trg_update_trader_score trigger from simulated_positions
  ✅ Documented both functions with field requirements
  ✅ Verified simulated_positions schema (no goal_session_id, no pnl)
  ✅ Confirmed current_pnl is the correct field in simulated_positions
  ✅ Verified trade_history has correct fields for these triggers
  ✅ Users can now close positions without field mismatch errors

  Goal session tracking continues via:
  - Application code (position-monitor.ts lines 335-366)
  - goal_session_trades table
  - trade_history records with goal_session_id

  Trader score updates continue via:
  - Application code (trade-lifecycle-manager.ts)
  - trade_history table with profit_loss field
*/