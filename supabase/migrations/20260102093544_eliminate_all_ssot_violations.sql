/*
  # Eliminate ALL SSOT Violations - Enforce Single Source of Truth

  ## Problem
  Multiple functions were implementing their own P&L calculations instead of
  delegating to the authoritative SSOT functions. This violates the core principle
  that calculate_pnl_universal is the ONLY authority for P&L calculations.

  ## Violations Found
  1. calculate_position_pnl() - Duplicates entire calculate_pnl_universal logic
  2. get_position_current_pnl() - Has inline calculations in fallback
  3. admin_recalculate_user_balance() - Hardcodes starting balance

  ## Solution
  1. Replace calculate_position_pnl with direct call to calculate_pnl_universal
  2. Update get_position_current_pnl fallback to call calculate_pnl_universal
  3. Create get_default_starting_balance() SSOT function
  4. Update admin_recalculate_user_balance to use SSOT function

  ## Architecture Rule
  If a function can be fixed in more than one place, the architecture is broken.
  ALL P&L calculations MUST go through calculate_pnl_universal.
*/

-- ============================================================================
-- STEP 1: Create SSOT function for default starting balance
-- ============================================================================

CREATE OR REPLACE FUNCTION get_default_starting_balance()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 10000.00::numeric;
$$;

COMMENT ON FUNCTION get_default_starting_balance IS
'SINGLE SOURCE OF TRUTH for default starting balance. Returns 10000.00 for all new users.';

-- ============================================================================
-- STEP 2: Replace calculate_position_pnl to delegate to calculate_pnl_universal
-- ============================================================================

-- This function was duplicating the entire P&L calculation logic.
-- Now it simply delegates to the authoritative SSOT function.

CREATE OR REPLACE FUNCTION calculate_position_pnl(
  p_symbol TEXT,
  p_direction TEXT,
  p_entry_price NUMERIC,
  p_current_price NUMERIC,
  p_lot_size NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- SSOT DELEGATION: All P&L calculations must go through calculate_pnl_universal
  RETURN calculate_pnl_universal(
    p_symbol,
    p_direction,
    p_entry_price,
    p_current_price,
    p_lot_size
  );
END;
$$;

COMMENT ON FUNCTION calculate_position_pnl IS
'SSOT DELEGATION: Calls calculate_pnl_universal (the authoritative SSOT for P&L).
This function exists only for backward compatibility.
Updated: 2026-01-02 - Eliminated inline calculations, now delegates to SSOT.';

-- ============================================================================
-- STEP 3: Fix get_position_current_pnl to use SSOT in fallback
-- ============================================================================

CREATE OR REPLACE FUNCTION get_position_current_pnl(p_position_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade goal_session_trades;
  v_current_price numeric;
BEGIN
  -- Get the position with its stored current_pnl
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = p_position_id AND status = 'open';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- SINGLE SOURCE OF TRUTH: Use pre-calculated current_pnl from Position Monitor
  -- The Position Monitor Service updates this value every 2-3 seconds with live prices
  IF v_trade.current_pnl IS NOT NULL THEN
    RETURN v_trade.current_pnl;
  END IF;

  -- FALLBACK: Use SSOT function instead of inline calculation
  -- Only if current_pnl is NULL (legacy data or edge cases)
  RAISE NOTICE 'Position % has NULL current_pnl, using SSOT fallback', p_position_id;

  -- Get latest price from realtime_prices
  SELECT mid INTO v_current_price
  FROM realtime_prices
  WHERE symbol = v_trade.symbol
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback to current_price on position if no realtime price
  IF v_current_price IS NULL THEN
    v_current_price := v_trade.current_price;
  END IF;

  IF v_current_price IS NULL OR v_current_price <= 0 THEN
    RETURN 0;
  END IF;

  -- SSOT DELEGATION: Use calculate_pnl_universal (NO inline calculations)
  RETURN calculate_pnl_universal(
    v_trade.symbol,
    COALESCE(v_trade.direction, v_trade.position_type),
    v_trade.entry_price,
    v_current_price,
    COALESCE(v_trade.lot_size, v_trade.position_size, 0.01)
  );
END;
$$;

COMMENT ON FUNCTION get_position_current_pnl IS
'SSOT: Returns pre-calculated current_pnl from Position Monitor Service.
Fallback uses calculate_pnl_universal (SSOT) if stored value is NULL.
Updated: 2026-01-02 - Eliminated inline calculations in fallback, now uses SSOT.';

-- ============================================================================
-- STEP 4: Fix admin_recalculate_user_balance to use SSOT
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_recalculate_user_balance(
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  old_balance numeric;
  goal_trades_pnl numeric;
  total_goal_trades bigint;
  correct_balance numeric;
  balance_diff numeric;
  starting_balance numeric;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();

  -- Check if calling user is admin
  SELECT up.is_admin INTO is_calling_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  -- Enforce admin-only access
  IF NOT COALESCE(is_calling_user_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Validate target user exists
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Get current account balance
  SELECT account_balance INTO old_balance
  FROM user_profiles
  WHERE id = target_user_id;

  -- Calculate total PnL from goal session trades
  SELECT
    COALESCE(SUM(profit_loss), 0),
    COUNT(*)
  INTO goal_trades_pnl, total_goal_trades
  FROM goal_session_trades
  WHERE user_id = target_user_id
  AND status IN ('closed', 'stopped', 'manual_close')
  AND profit_loss IS NOT NULL;

  -- SSOT DELEGATION: Use get_default_starting_balance() instead of hardcoded 10000
  starting_balance := get_default_starting_balance();
  correct_balance := starting_balance + goal_trades_pnl;

  -- Calculate difference
  balance_diff := correct_balance - old_balance;

  -- Update user balance if there's a difference
  IF ABS(balance_diff) > 0.01 THEN
    UPDATE user_profiles
    SET
      account_balance = correct_balance,
      updated_at = NOW()
    WHERE id = target_user_id;
  END IF;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'correct_balance', correct_balance,
    'balance_diff', balance_diff,
    'starting_balance', starting_balance,
    'trades_pnl', 0,
    'goal_trades_pnl', goal_trades_pnl,
    'total_trades', 0,
    'total_goal_trades', total_goal_trades
  );
END;
$$;

COMMENT ON FUNCTION admin_recalculate_user_balance IS
'Admin function to recalculate user balance from closed trades.
Updated: 2026-01-02 - Now uses get_default_starting_balance() SSOT function.';

-- ============================================================================
-- STEP 5: Add database-level validation and warnings
-- ============================================================================

-- Add warning comments to all SSOT functions
COMMENT ON FUNCTION calculate_pnl_universal IS
'⚠️ SINGLE SOURCE OF TRUTH FOR P&L CALCULATIONS ⚠️
This is the ONLY function that should implement P&L calculation logic.
ALL other functions MUST delegate to this function.
DO NOT duplicate this logic anywhere else in the codebase.
Updated: 2026-01-02 - Marked as authoritative SSOT.';

COMMENT ON FUNCTION calculate_pip_distance IS
'⚠️ SINGLE SOURCE OF TRUTH FOR PIP DISTANCE ⚠️
This is the ONLY function that should calculate pip distance.
DO NOT duplicate this logic anywhere else.';

COMMENT ON FUNCTION calculate_dollar_per_pip IS
'⚠️ SINGLE SOURCE OF TRUTH FOR DOLLAR PER PIP ⚠️
This is the ONLY function that should calculate dollar per pip value.
DO NOT duplicate this logic anywhere else.';

-- ============================================================================
-- STEP 6: Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_default_starting_balance() TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION calculate_position_pnl(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_position_current_pnl(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_recalculate_user_balance(uuid) TO authenticated;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║          SSOT VIOLATIONS ELIMINATED                           ║';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'FIXED FUNCTIONS:';
  RAISE NOTICE '';
  RAISE NOTICE '1. ✓ calculate_position_pnl()';
  RAISE NOTICE '   - NOW: Delegates to calculate_pnl_universal';
  RAISE NOTICE '   - BEFORE: Duplicated entire P&L calculation logic';
  RAISE NOTICE '';
  RAISE NOTICE '2. ✓ get_position_current_pnl()';
  RAISE NOTICE '   - NOW: Fallback uses calculate_pnl_universal';
  RAISE NOTICE '   - BEFORE: Had inline calculations with hardcoded multipliers';
  RAISE NOTICE '';
  RAISE NOTICE '3. ✓ admin_recalculate_user_balance()';
  RAISE NOTICE '   - NOW: Uses get_default_starting_balance() SSOT';
  RAISE NOTICE '   - BEFORE: Hardcoded starting balance as 10000';
  RAISE NOTICE '';
  RAISE NOTICE '4. ✓ get_default_starting_balance()';
  RAISE NOTICE '   - NEW SSOT function for default starting balance';
  RAISE NOTICE '   - Returns: 10000.00';
  RAISE NOTICE '';
  RAISE NOTICE 'ARCHITECTURE ENFORCEMENT:';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  ALL P&L calculations MUST use calculate_pnl_universal';
  RAISE NOTICE '⚠️  ALL pip distances MUST use calculate_pip_distance';
  RAISE NOTICE '⚠️  ALL dollar/pip values MUST use calculate_dollar_per_pip';
  RAISE NOTICE '⚠️  ALL starting balances MUST use get_default_starting_balance';
  RAISE NOTICE '';
  RAISE NOTICE 'RULE: If a function can be fixed in more than one place,';
  RAISE NOTICE '      the architecture is broken.';
  RAISE NOTICE '';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
END $$;
