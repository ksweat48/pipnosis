/**
 * CCIP Emergency Fix - Close Oratio89's XAUUSD Trade (Correct Close Reason)
 *
 * PROBLEM:
 * Previous attempt used invalid close_reason 'manual_admin_closure'
 * Valid close_reasons: manual, force_closed, stop_loss, take_profit, etc.
 *
 * FIX:
 * Use 'force_closed' as valid close_reason
 * Call RPC function with correct parameters
 *
 * TRADE DETAILS:
 * - ID: f2f0bc4f-9d58-4cef-b217-338ed5a64813
 * - User: oratio89@gmail.com
 * - Symbol: XAUUSD SELL
 * - Entry: 5201.10, Current: 4845.72
 * - Expected P&L: +$340.64
 *
 * CCIP VERSION: 2026-01-30-004
 * GOVERNANCE: SSOT-compliant emergency closure
 */

DO $$
DECLARE
  v_trade_id UUID := 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;
  v_user_id UUID;
  v_session_id UUID;
  v_close_price NUMERIC := 4845.72;
  v_result JSONB;
  v_old_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Get trade info
  SELECT user_id, goal_session_id
  INTO v_user_id, v_session_id
  FROM goal_session_trades
  WHERE id = v_trade_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE NOTICE 'Trade already closed or not found';
    RETURN;
  END IF;

  SELECT account_balance INTO v_old_balance
  FROM user_profiles WHERE id = v_user_id;

  RAISE NOTICE 'Closing trade % at price %', v_trade_id, v_close_price;

  -- ✅ SSOT: Use RPC function with VALID close_reason
  SELECT close_goal_session_trade(
    p_trade_id := v_trade_id,
    p_close_price := v_close_price,
    p_close_reason := 'force_closed',  -- ✅ Valid reason from constraint
    p_goal_session_id := v_session_id,
    p_force_close := true
  ) INTO v_result;

  SELECT account_balance INTO v_new_balance
  FROM user_profiles WHERE id = v_user_id;

  -- Governance logging
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value,
    reason, requester_id, metadata
  ) VALUES (
    'goal_session_trades', v_trade_id, 'trade_closure',
    jsonb_build_object('status', 'open', 'balance', v_old_balance),
    jsonb_build_object('status', 'closed', 'balance', v_new_balance, 'pnl', v_new_balance - v_old_balance),
    'CCIP-20260130-004: Emergency closure with valid close_reason',
    v_user_id,
    jsonb_build_object(
      'ccip_version', '2026-01-30-004',
      'close_price', v_close_price,
      'pnl', v_new_balance - v_old_balance,
      'rpc_result', v_result
    )
  );

  RAISE NOTICE '✅ Trade closed: Balance $% → $% (P&L: $%)',
    v_old_balance, v_new_balance, v_new_balance - v_old_balance;

END $$;

-- Verify
DO $$
DECLARE
  v_status TEXT;
  v_pnl NUMERIC;
BEGIN
  SELECT status, profit_loss INTO v_status, v_pnl
  FROM goal_session_trades
  WHERE id = 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;

  IF v_status = 'closed' THEN
    RAISE NOTICE '✅ VERIFIED: Trade closed successfully, P&L: $%', v_pnl;
  ELSE
    RAISE WARNING '❌ FAILED: Trade status is still %', v_status;
  END IF;
END $$;
