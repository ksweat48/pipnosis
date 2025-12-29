/*
  # Fix admin_reconcile_user_balance Function

  ## Problem
  - Function references non-existent `simulated_positions` table
  - Only `goal_session_trades` table exists for trades

  ## Solution
  - Remove reference to simulated_positions
  - Calculate balance only from goal_session_trades
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_reconcile_user_balance(uuid);

-- Recreate with correct table references
CREATE OR REPLACE FUNCTION admin_reconcile_user_balance(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_balance numeric;
  v_current_balance numeric;
  v_discrepancy numeric;
  v_starting_balance numeric := 10000; -- Default starting balance
  v_total_goal_pnl numeric;
  v_total_adjustments numeric;
  v_result jsonb;
BEGIN
  -- Verify admin access
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: admin privileges required';
  END IF;

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = p_user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  -- Calculate total P&L from goal trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO v_total_goal_pnl
  FROM goal_session_trades
  WHERE user_id = p_user_id AND status = 'closed' AND profit_loss IS NOT NULL;

  -- Calculate manual adjustments from balance_transactions
  SELECT COALESCE(SUM(amount), 0) INTO v_total_adjustments
  FROM balance_transactions
  WHERE user_id = p_user_id
    AND transaction_type NOT IN ('trade_pnl');

  -- Calculate expected balance
  v_expected_balance := v_starting_balance + v_total_goal_pnl + v_total_adjustments;
  v_discrepancy := v_current_balance - v_expected_balance;

  -- Build result
  v_result := jsonb_build_object(
    'user_id', p_user_id,
    'current_balance', v_current_balance,
    'expected_balance', v_expected_balance,
    'discrepancy', v_discrepancy,
    'breakdown', jsonb_build_object(
      'starting_balance', v_starting_balance,
      'goal_trades_pnl', v_total_goal_pnl,
      'manual_adjustments', v_total_adjustments
    ),
    'needs_correction', abs(v_discrepancy) > 0.01
  );

  RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_reconcile_user_balance(uuid) TO authenticated;
