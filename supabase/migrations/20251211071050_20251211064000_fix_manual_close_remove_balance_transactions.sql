/*
  # CRITICAL FIX: Manual Position Close Failing

  ## Problem
  User cannot close positions manually - getting 404 and "balance_transactions does not exist" error

  ## Root Cause
  - Migration 20251211022701 deleted balance_transactions table
  - close_goal_session_trade() function still tries to INSERT into deleted table
  - Function fails → user can't close position

  ## Solution
  Remove balance_transactions INSERT from function while keeping all other logic:
  - P&L calculation ✅
  - Balance update ✅
  - Trade status update ✅
  - Remove transaction log ❌ (not critical for manual close)

  ## Impact
  Manual position closes will work immediately
*/

-- ============================================================================
-- Fix close_goal_session_trade to remove balance_transactions dependency
-- ============================================================================

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_result jsonb;
BEGIN
  -- Validate close reason
  IF p_close_reason NOT IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop') THEN
    RAISE EXCEPTION 'Invalid close_reason: %. Must be one of: manual, stop_loss, take_profit, goal_achieved, goal_expired, session_ended, risk_limit, trailing_stop', p_close_reason;
  END IF;

  -- Get trade details with goal_session_id verification
  IF p_goal_session_id IS NOT NULL THEN
    -- Verify trade belongs to specified session
    SELECT * INTO v_trade
    FROM goal_session_trades
    WHERE id = p_trade_id
      AND goal_session_id = p_goal_session_id
      AND status IN ('open', 'pending', 'soft_closing');
  ELSE
    -- Fallback for backward compatibility (but still verify ownership)
    SELECT * INTO v_trade
    FROM goal_session_trades
    WHERE id = p_trade_id
      AND status IN ('open', 'pending', 'soft_closing');
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade % not found, already closed, wrong session, or not in valid state', p_trade_id;
  END IF;

  -- Verify access (user owns it or service role)
  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: trade belongs to different user';
  END IF;

  -- Calculate P&L using proper forex pip calculation
  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.01;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000;
  ELSE
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.0001;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10;
  END IF;

  -- Calculate P&L based on direction
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_calculated_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  -- Update the trade record
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

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User profile not found for user_id: %', v_trade.user_id;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + v_calculated_pnl;

  -- Update user balance
  UPDATE user_profiles
  SET account_balance = v_new_balance,
      updated_at = now()
  WHERE id = v_trade.user_id;

  -- 🚨 REMOVED: balance_transactions INSERT (table was deleted in consolidation)
  -- Balance is updated directly in user_profiles above
  -- Transaction history can be reconstructed from goal_session_trades if needed

  -- Return result with all details
  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance,
    'balance_after', v_new_balance
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) IS
  'Closes a goal session trade with session verification and automatic balance updates. Fixed: removed balance_transactions dependency after table consolidation.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO service_role;