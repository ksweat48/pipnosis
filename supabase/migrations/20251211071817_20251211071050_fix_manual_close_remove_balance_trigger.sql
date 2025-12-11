/*
  # EMERGENCY FIX: Remove Broken Trigger Blocking Manual Closes

  ## Critical Issue
  User STILL cannot close positions! The trigger "trigger_auto_balance_update_goal_trades"
  is trying to INSERT into balance_transactions table which no longer exists.

  ## Root Cause Timeline
  1. Migration 20251211013935 created trigger_auto_balance_update_goal_trades
     - This trigger fires on UPDATE of goal_session_trades
     - It tries to INSERT into balance_transactions
  
  2. Migration 20251211022701 dropped balance_transactions table
     - Should have CASCADE deleted the trigger, but it's still there!
  
  3. Result: Every trade close UPDATE triggers error: "balance_transactions does not exist"

  ## Errors in Production
  - PATCH /goal_session_trades → 404 (trigger fails)
  - POST /rpc/close_goal_session_trade → 404 (function tries to INSERT)
  - User: "trade is stuck!"

  ## Solution
  1. DROP the broken trigger completely
  2. DROP the trigger function
  3. Balance updates are handled in close_goal_session_trade() RPC function only
  4. No need for "safety net" trigger anymore since we simplified to goal_based_only

  ## Impact
  Manual position closes will FINALLY work!
*/

-- ============================================================================
-- Drop the broken trigger and function
-- ============================================================================

-- Drop trigger first
DROP TRIGGER IF EXISTS trigger_auto_balance_update_goal_trades ON goal_session_trades;

-- Drop the function
DROP FUNCTION IF EXISTS auto_update_balance_on_goal_trade_close();

-- ============================================================================
-- Verify no other triggers reference balance_transactions
-- ============================================================================

-- List all remaining triggers on goal_session_trades for verification
DO $$
DECLARE
  trigger_record RECORD;
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'EMERGENCY FIX: Removed Broken Balance Trigger';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Dropped trigger: trigger_auto_balance_update_goal_trades';
  RAISE NOTICE '✅ Dropped function: auto_update_balance_on_goal_trade_close()';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining triggers on goal_session_trades:';
  
  FOR trigger_record IN 
    SELECT tgname 
    FROM pg_trigger 
    WHERE tgrelid = 'goal_session_trades'::regclass 
    AND tgname NOT LIKE 'RI_%'  -- Exclude foreign key triggers
  LOOP
    RAISE NOTICE '  - %', trigger_record.tgname;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE 'IMPACT: Manual position closes will now work!';
  RAISE NOTICE 'Balance updates handled by close_goal_session_trade() RPC only';
  RAISE NOTICE '=================================================================';
END $$;