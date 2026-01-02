/*
  # Fix close_goal_session_trade to Use SSOT and Reset User Account

  ## Problem
  The close_goal_session_trade function has TWO overloaded versions, NEITHER uses SSOT:

  1. 4-param version: Uses inline calculation with $1 per lot for indices (should be $100)
  2. 5-param version: Has NO indices handling at all - falls through to forex calculation
     dividing by 0.0001, causing 1000x error for indices!

  This caused a NAS100 trade that should have been +$564.42 to be calculated as +$564,420,
  inflating user balance from ~$10k to $573k.

  ## Solution
  1. Drop BOTH overloaded versions of close_goal_session_trade
  2. Create a single unified function that calls calculate_pnl_universal (SSOT)
  3. Reset affected user's balance to $10,000
  4. Delete the problematic open trade

  ## SSOT Principle
  All P&L calculations MUST go through calculate_pnl_universal which uses calculate_dollar_per_pip.
  NO inline P&L calculations allowed in any function.
*/

-- ============================================================================
-- STEP 1: Drop BOTH overloaded versions of close_goal_session_trade
-- ============================================================================

DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid, boolean) CASCADE;

-- ============================================================================
-- STEP 2: Create unified close_goal_session_trade using SSOT
-- ============================================================================

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL,
  p_force_close boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_result jsonb;
  v_rows_updated integer;
  v_lot_size numeric;
BEGIN
  IF p_close_reason NOT IN (
    'manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired',
    'session_ended', 'risk_limit', 'trailing_stop', 'timeout', 'safety_net',
    'user_stopped', 'breakeven', 'alpha_override', 'ai_decision', 'goal_met',
    'weekend_shutdown', 'force_close'
  ) THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade %', p_trade_id;

  IF p_goal_session_id IS NOT NULL THEN
    IF p_force_close THEN
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND goal_session_id = p_goal_session_id;
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND goal_session_id = p_goal_session_id
      AND status IN ('open', 'pending', 'soft_closing');
    END IF;
  ELSE
    IF p_force_close THEN
      SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id;
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND status IN ('open', 'pending', 'soft_closing');
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade not found or already closed';
  END IF;

  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied';
  END IF;

  IF v_trade.status = 'closed' AND NOT p_force_close THEN
    RAISE EXCEPTION 'Trade % is already closed', p_trade_id;
  END IF;

  v_lot_size := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);

  v_calculated_pnl := calculate_pnl_universal(
    v_trade.symbol,
    v_trade.direction,
    v_trade.entry_price,
    p_close_price,
    v_lot_size
  );

  RAISE LOG '[close_goal_session_trade] SSOT P&L: Symbol=%, Entry=%, Exit=%, Lot=%, PnL=%',
    v_trade.symbol, v_trade.entry_price, p_close_price, v_lot_size, v_calculated_pnl;

  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now()
  WHERE id = p_trade_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update trade';
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found';
  END IF;

  IF v_trade.status != 'closed' THEN
    v_new_balance := v_current_balance + v_calculated_pnl;

    UPDATE user_profiles
    SET account_balance = v_new_balance, updated_at = now()
    WHERE id = v_trade.user_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance';
    END IF;

    RAISE LOG '[close_goal_session_trade] Balance: % + % = %',
      v_current_balance, v_calculated_pnl, v_new_balance;
  ELSE
    v_new_balance := v_current_balance;
    RAISE LOG '[close_goal_session_trade] Skipped balance update - position was already closed';
  END IF;

  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'lot_size', v_lot_size,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance,
    'balance_after', v_new_balance,
    'ssot_calculation', true
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean) TO service_role;

-- ============================================================================
-- STEP 3: Reset user greenmorris.83@gmail.com account
-- ============================================================================

DO $$
DECLARE
  v_user_id uuid := 'e6f3399f-deff-43af-b0fc-6ad8ad5ccb88';
  v_trade_id uuid := 'a02327c3-fb69-439e-b135-00483786fd9a';
  v_old_balance numeric;
  v_session_id uuid;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  RESETTING USER ACCOUNT: greenmorris.83@gmail.com';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  SELECT account_balance INTO v_old_balance
  FROM user_profiles WHERE id = v_user_id;

  RAISE NOTICE '  Old Balance: $%', v_old_balance;

  SELECT goal_session_id INTO v_session_id
  FROM goal_session_trades WHERE id = v_trade_id;

  DELETE FROM goal_session_trades WHERE id = v_trade_id;
  RAISE NOTICE '  Deleted open trade: %', v_trade_id;

  UPDATE user_profiles
  SET account_balance = 10000.00, updated_at = now()
  WHERE id = v_user_id;

  RAISE NOTICE '  New Balance: $10,000.00';
  RAISE NOTICE '  Correction: $%', (10000.00 - v_old_balance);

  IF v_session_id IS NOT NULL THEN
    UPDATE goal_sessions
    SET status = 'scanning', updated_at = now()
    WHERE id = v_session_id
    AND NOT EXISTS (
      SELECT 1 FROM goal_session_trades
      WHERE goal_session_id = v_session_id AND status = 'open'
    );
    RAISE NOTICE '  Updated session status to scanning';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  ACCOUNT RESET COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- STEP 4: Verify SSOT functions exist and are correct
-- ============================================================================

DO $$
DECLARE
  v_test_pnl numeric;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  VERIFYING SSOT P&L CALCULATIONS';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  v_test_pnl := calculate_pnl_universal('NAS100', 'buy', 25462.43, 25474.70, 0.46);
  RAISE NOTICE '  NAS100 test: Entry=25462.43, Exit=25474.70, Lot=0.46';
  RAISE NOTICE '  Expected: ~$564.42, Got: $%', v_test_pnl;

  IF ABS(v_test_pnl - 564.42) > 1 THEN
    RAISE WARNING '  NAS100 calculation may be incorrect!';
  ELSE
    RAISE NOTICE '  NAS100 calculation CORRECT';
  END IF;

  v_test_pnl := calculate_pnl_universal('US30', 'sell', 48510, 48497, 0.17);
  RAISE NOTICE '';
  RAISE NOTICE '  US30 test: Entry=48510, Exit=48497, Lot=0.17 (sell)';
  RAISE NOTICE '  Expected: ~$221.00, Got: $%', v_test_pnl;

  v_test_pnl := calculate_pnl_universal('EURUSD', 'buy', 1.08000, 1.08100, 1.0);
  RAISE NOTICE '';
  RAISE NOTICE '  EURUSD test: Entry=1.08000, Exit=1.08100, Lot=1.0';
  RAISE NOTICE '  Expected: ~$100.00, Got: $%', v_test_pnl;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  close_goal_session_trade NOW USES SSOT!';
  RAISE NOTICE '  All P&L calculations go through calculate_pnl_universal';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

COMMENT ON FUNCTION close_goal_session_trade IS
'SSOT Trade Closure Function - Updated 2026-01-02. Uses calculate_pnl_universal for ALL P&L calculations.';
