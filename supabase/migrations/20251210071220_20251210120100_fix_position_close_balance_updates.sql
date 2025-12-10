/*
  # Fix Position Close Functions to Use account_balance

  Update all database functions that were updating demo_balance
  to use account_balance instead, since demo_balance was removed.

  Functions updated:
  - manual_close_position
  - Any triggers that update balance on position close
*/

-- ============================================================================
-- Fix manual_close_position function
-- ============================================================================

CREATE OR REPLACE FUNCTION manual_close_position(
  p_position_id uuid,
  p_close_price numeric
)
RETURNS json AS $$
DECLARE
  v_position RECORD;
  v_realized_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
BEGIN
  -- Get position details
  SELECT * INTO v_position
  FROM simulated_positions
  WHERE id = p_position_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Position not found');
  END IF;

  -- Calculate realized P&L
  IF v_position.position_type = 'buy' THEN
    v_realized_pnl := (p_close_price - v_position.entry_price) * (v_position.lot_size * 100000);
  ELSE
    v_realized_pnl := (v_position.entry_price - p_close_price) * (v_position.lot_size * 100000);
  END IF;

  -- Update position to closed
  UPDATE simulated_positions
  SET
    status = 'closed',
    exit_price = p_close_price,
    current_price = p_close_price,
    current_pnl = v_realized_pnl,
    realized_pnl = v_realized_pnl,
    close_reason = 'manual',
    closed_at = now(),
    updated_at = now()
  WHERE id = p_position_id;

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_position.user_id;

  -- Calculate new balance
  v_new_balance := v_current_balance + v_realized_pnl;

  -- Update user balance
  UPDATE user_profiles
  SET account_balance = v_new_balance
  WHERE id = v_position.user_id;

  -- Insert into balance_transactions
  INSERT INTO balance_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    position_id,
    description
  ) VALUES (
    v_position.user_id,
    'trade_pnl',
    v_realized_pnl,
    v_current_balance,
    v_new_balance,
    p_position_id,
    'Manual position close: ' || v_position.symbol
  );

  RETURN json_build_object(
    'success', true,
    'realized_pnl', v_realized_pnl,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;