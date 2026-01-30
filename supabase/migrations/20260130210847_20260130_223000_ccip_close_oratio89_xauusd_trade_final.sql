/**
 * CCIP Emergency Fix - Close Oratio89's Stuck XAUUSD Trade (FINAL)
 *
 * PROBLEM:
 * Previous migration closed wrong trade ID. Found actual open trade:
 * - Trade ID: f2f0bc4f-9d58-4cef-b217-338ed5a64813
 * - User: oratio89@gmail.com
 * - Symbol: XAUUSD SELL
 * - Entry: 5201.10
 * - Current: 4845.72 (bid)
 * - Unrealized P&L: +$340.64
 *
 * FIX:
 * Use SSOT-compliant close_goal_session_trade RPC function
 * Full governance tracking and audit trail
 *
 * MIGRATION: 20260130_223000_ccip_close_oratio89_xauusd_trade_final.sql
 * CCIP VERSION: 2026-01-30-003
 * GOVERNANCE: Emergency trade closure with full audit trail
 */

-- ============================================================================
-- PART 1: Close the trade using SSOT authority (RPC function)
-- ============================================================================

DO $$
DECLARE
  v_trade_id UUID := 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;
  v_user_id UUID;
  v_session_id UUID;
  v_current_price NUMERIC := 4845.72; -- Current XAUUSD bid price
  v_close_result JSONB;
  v_old_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Get trade details
  SELECT user_id, goal_session_id
  INTO v_user_id, v_session_id
  FROM goal_session_trades
  WHERE id = v_trade_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE NOTICE 'Trade % already closed or not found', v_trade_id;
    RETURN;
  END IF;

  -- Get user's current balance
  SELECT account_balance INTO v_old_balance
  FROM user_profiles
  WHERE id = v_user_id;

  RAISE NOTICE '🔄 Closing trade using SSOT authority: close_goal_session_trade()';
  RAISE NOTICE '   Trade ID: %', v_trade_id;
  RAISE NOTICE '   Close Price: %', v_current_price;
  RAISE NOTICE '   Old Balance: $%', v_old_balance;

  -- ✅ SSOT COMPLIANT: Use the RPC function as single authority for trade closure
  SELECT close_goal_session_trade(
    p_trade_id := v_trade_id,
    p_close_price := v_current_price,
    p_close_reason := 'manual_admin_closure',
    p_goal_session_id := v_session_id,
    p_force_close := true
  ) INTO v_close_result;

  -- Get new balance after closure
  SELECT account_balance INTO v_new_balance
  FROM user_profiles
  WHERE id = v_user_id;

  -- Log to governance audit trail
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    old_value,
    new_value,
    reason,
    requester_id,
    metadata
  ) VALUES (
    'goal_session_trades',
    v_trade_id,
    'trade_closure',
    jsonb_build_object(
      'status', 'open',
      'balance', v_old_balance
    ),
    jsonb_build_object(
      'status', 'closed',
      'balance', v_new_balance,
      'pnl', v_new_balance - v_old_balance
    ),
    'CCIP-20260130-003: Emergency trade closure using SSOT RPC function',
    v_user_id,
    jsonb_build_object(
      'ccip_version', '2026-01-30-003',
      'migration', '20260130_223000',
      'symbol', 'XAUUSD',
      'close_price', v_current_price,
      'method', 'close_goal_session_trade RPC'
    )
  );

  RAISE NOTICE '✅ Trade closed successfully using SSOT authority';
  RAISE NOTICE '   New Balance: $%', v_new_balance;
  RAISE NOTICE '   P&L: $%', v_new_balance - v_old_balance;

END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_trade_status TEXT;
  v_user_email TEXT;
  v_user_balance NUMERIC;
  v_pnl NUMERIC;
BEGIN
  -- Verify trade is closed
  SELECT t.status, up.email, up.account_balance, t.profit_loss
  INTO v_trade_status, v_user_email, v_user_balance, v_pnl
  FROM goal_session_trades t
  JOIN user_profiles up ON t.user_id = up.id
  WHERE t.id = 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;

  IF v_trade_status = 'closed' THEN
    RAISE NOTICE '✅ VERIFICATION SUCCESS:';
    RAISE NOTICE '   Trade Status: closed';
    RAISE NOTICE '   User: %', v_user_email;
    RAISE NOTICE '   New Balance: $%', v_user_balance;
    RAISE NOTICE '   Trade P&L: $%', v_pnl;
  ELSE
    RAISE WARNING '❌ VERIFICATION FAILED: Trade status is %', v_trade_status;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'CCIP-20260130-003: Emergency Trade Closure COMPLETE (SSOT Compliant)';
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'Method: close_goal_session_trade RPC function (Single Source of Truth)';
  RAISE NOTICE 'User oratio89@gmail.com should hard refresh browser to see updated balance';
  RAISE NOTICE '=============================================================================';

END $$;
