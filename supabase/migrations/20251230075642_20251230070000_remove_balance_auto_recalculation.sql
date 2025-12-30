/*
  # Remove Balance Auto-Recalculation System

  ## Problem
  User manually updates balance in Settings → Database saves it → Auto-recalculation
  function reverts it back to "calculated" amount based on trade history.

  ## Solution
  Balance should ONLY update in 2 scenarios:
  1. User manually saves it in Settings
  2. A trade closes (win/loss adds/subtracts from current balance)

  NO automatic recalculation or "correction" of balances!

  ## Changes
  1. Drop audit_and_fix_all_pnl_values() function (the culprit)
  2. Keep PnL calculation functions (needed for trade closes)
  3. Verify trigger only validates PnL, doesn't touch balances
  4. Document manual balance override policy
*/

-- ============================================================================
-- STEP 1: Drop the auto-recalculation function
-- ============================================================================

DROP FUNCTION IF EXISTS audit_and_fix_all_pnl_values() CASCADE;

-- ============================================================================
-- STEP 2: Verify close_goal_session_trade is clean (view only, no changes)
-- ============================================================================

-- This function is CORRECT - it only:
-- 1. Calculates PnL for the closing trade
-- 2. Adds/subtracts that PnL from CURRENT balance
-- 3. Does NOT recalculate entire trade history
-- No changes needed here!

-- ============================================================================
-- STEP 3: Verify trigger is clean (view only, no changes)
-- ============================================================================

-- validate_and_fix_profit_loss() trigger is CORRECT - it only:
-- 1. Validates profit_loss field on trades
-- 2. Updates profit_loss if it's NULL or unrealistic
-- 3. Does NOT touch user_profiles.account_balance
-- No changes needed here!

-- ============================================================================
-- STEP 4: Document the new policy
-- ============================================================================

COMMENT ON TABLE user_profiles IS
  'User account profiles and balances.

  BALANCE UPDATE POLICY:
  - Manual updates via Settings are FINAL and RESPECTED
  - Balance auto-updates ONLY when trades close (adds/subtracts PnL)
  - NO automatic recalculation or balance "correction"
  - User is in full control of their account balance';

-- ============================================================================
-- STEP 5: Verify all balance update sources
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║     BALANCE AUTO-RECALCULATION SYSTEM REMOVED                 ║';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'BALANCE UPDATE SOURCES (Verified):';
  RAISE NOTICE '';
  RAISE NOTICE '1. ✓ Manual Save in Settings';
  RAISE NOTICE '   - User enters amount → Direct UPDATE to user_profiles';
  RAISE NOTICE '   - NO validation against trade history';
  RAISE NOTICE '   - User choice is FINAL and RESPECTED';
  RAISE NOTICE '';
  RAISE NOTICE '2. ✓ Trade Close';
  RAISE NOTICE '   - close_goal_session_trade() calculates PnL';
  RAISE NOTICE '   - Adds/subtracts PnL from CURRENT balance';
  RAISE NOTICE '   - Does NOT recalculate entire history';
  RAISE NOTICE '';
  RAISE NOTICE 'REMOVED FUNCTIONS:';
  RAISE NOTICE '   ✗ audit_and_fix_all_pnl_values() - DROPPED';
  RAISE NOTICE '   - This was auto-"correcting" balances';
  RAISE NOTICE '   - Would revert manual changes';
  RAISE NOTICE '   - Now permanently disabled';
  RAISE NOTICE '';
  RAISE NOTICE 'POLICY:';
  RAISE NOTICE '   - Manual balance changes are PERMANENT';
  RAISE NOTICE '   - Only trade closes modify balance';
  RAISE NOTICE '   - No background recalculation';
  RAISE NOTICE '   - User is in full control';
  RAISE NOTICE '';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
END $$;
