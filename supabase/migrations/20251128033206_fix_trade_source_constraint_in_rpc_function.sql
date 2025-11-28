/*
  # Fix trade_source Constraint Violation in close_simulated_position_secure()

  ## Problem
  Users cannot close positions manually - getting error:
  "new row for relation 'trade_history' violates check constraint 'trade_history_trade_source_check'"

  ## Root Cause
  The RPC function `close_simulated_position_secure()` inserts 'manual' as trade_source,
  but the CHECK constraint only allows: 'live_demo', 'synthetic_backtest', 'real_backtest'

  Location: Line 222 in function close_simulated_position_secure()
  Current value: 'manual' ❌
  Should be: 'live_demo' ✅

  ## Solution
  Replace the function with corrected trade_source value.
  These are live demo positions, so 'live_demo' is the correct value.

  ## Impact
  - FIXES: Manual position closes (X button click)
  - FIXES: All RPC-based position closures
  - NO BREAKING CHANGES: Function signature unchanged
  - NO DATA LOSS: Existing trade_history records unaffected

  ## Related Files
  - Frontend: src/services/simulated-trading.ts (calls this RPC)
  - Frontend: src/components/ActivePositions.tsx (manual close button)
  - Backend: position-monitor.ts (auto-close, already fixed separately)
*/

-- ============================================================================
-- Replace close_simulated_position_secure with fixed trade_source value
-- ============================================================================

CREATE OR REPLACE FUNCTION close_simulated_position_secure(
  p_position_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual'
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_position record;
  v_pnl numeric;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_result jsonb;
BEGIN
  -- Get position details and verify ownership
  SELECT * INTO v_position
  FROM simulated_positions
  WHERE id = p_position_id
  AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position % not found or not open', p_position_id;
  END IF;

  IF v_position.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: position belongs to different user';
  END IF;

  -- Calculate final P&L using proper forex pip calculation
  -- For standard pairs (e.g., EURUSD): pip = 0.0001
  -- For JPY pairs: pip = 0.01
  IF v_position.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_position.entry_price) / 0.01;
  ELSE
    v_pip_distance := (p_close_price - v_position.entry_price) / 0.0001;
  END IF;

  -- Dollar per pip = lot_size * 100000 * 0.0001 (for standard pairs)
  -- Simplified: lot_size * 10
  IF v_position.symbol LIKE '%JPY%' THEN
    v_dollar_per_pip := v_position.lot_size * 1000;
  ELSE
    v_dollar_per_pip := v_position.lot_size * 10;
  END IF;

  -- Calculate P&L based on direction
  IF v_position.position_type = 'buy' THEN
    v_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  -- Round P&L to 2 decimal places
  v_pnl := ROUND(v_pnl, 2);

  -- Close the position
  UPDATE simulated_positions
  SET
    status = 'closed',
    current_price = p_close_price,
    current_pnl = v_pnl,
    closed_at = now(),
    close_reason = p_close_reason,
    updated_at = now()
  WHERE id = p_position_id;

  -- Get current balance
  SELECT demo_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_position.user_id;

  v_new_balance := v_current_balance + v_pnl;

  -- Update user balance
  UPDATE user_profiles
  SET demo_balance = v_new_balance
  WHERE id = v_position.user_id;

  -- Create balance transaction
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
    v_pnl,
    v_current_balance,
    v_new_balance,
    p_position_id,
    format('Position closed (%s): %s %s %s lots',
      p_close_reason,
      v_position.symbol,
      v_position.position_type,
      v_position.lot_size
    )
  );

  -- Record in trade history
  -- ✅ FIXED: Changed trade_source from 'manual' to 'live_demo'
  INSERT INTO trade_history (
    user_id,
    position_id,
    symbol,
    position_type,
    lot_size,
    entry_price,
    exit_price,
    stop_loss,
    take_profit,
    profit_loss,
    opened_at,
    closed_at,
    close_reason,
    confidence_score,
    ai_analyzed,
    trade_source
  ) VALUES (
    v_position.user_id,
    p_position_id,
    v_position.symbol,
    v_position.position_type,
    v_position.lot_size,
    v_position.entry_price,
    p_close_price,
    v_position.stop_loss,
    v_position.take_profit,
    v_pnl,
    v_position.opened_at,
    now(),
    p_close_reason,
    75,
    false,
    'live_demo'
  );

  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'position_id', p_position_id,
    'pnl', v_pnl,
    'close_price', p_close_price,
    'new_balance', v_new_balance
  );

  RETURN v_result;
END;
$$;

-- Ensure function has correct permissions
GRANT EXECUTE ON FUNCTION close_simulated_position_secure TO authenticated;

-- Add comment documenting the fix
COMMENT ON FUNCTION close_simulated_position_secure IS
  'Securely closes a simulated position with full P&L calculation and balance updates.

   FIXED 2025-11-28: Changed trade_source from ''manual'' to ''live_demo'' to match
   CHECK constraint on trade_history table.

   Security: Uses SECURITY DEFINER to bypass RLS, but verifies auth.uid() = position.user_id';

-- Verify the function exists and was updated
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'close_simulated_position_secure'
  ) THEN
    RAISE NOTICE '✅ Function close_simulated_position_secure() successfully updated';
  ELSE
    RAISE EXCEPTION 'ERROR: Function close_simulated_position_secure() not found';
  END IF;
END $$;