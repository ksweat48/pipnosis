/*
  # Fix Manual Trade Close - Allow Closing Any Status

  ## Problem
  Users cannot manually close trades if they're in 'soft_closing' or other states.
  Error: "Position not found or not open"

  ## Root Cause
  The RPC function `close_simulated_position_secure()` only allows closing positions
  with status = 'open', but positions can be in 'soft_closing' state.

  Line 59: `AND status = 'open'` ❌

  ## Solution
  Allow closing positions in ANY state except 'closed':
  - 'open' ✅
  - 'soft_closing' ✅ (waiting for close)
  - Any other state ✅
  - 'closed' ❌ (already closed)

  ## User Impact
  CRITICAL FIX: Users can now force-close trades in any state.
  Manual close is FINAL - nothing should block it.
*/

-- ============================================================================
-- Replace close_simulated_position_secure to allow closing ANY non-closed position
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
  -- ✅ FIXED: Allow closing positions in ANY status except 'closed'
  SELECT * INTO v_position
  FROM simulated_positions
  WHERE id = p_position_id
  AND status != 'closed';  -- Changed from: AND status = 'open'

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position % not found or already closed', p_position_id;
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

  -- Close the position (force to 'closed' regardless of current status)
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
    'new_balance', v_new_balance,
    'previous_status', v_position.status
  );

  RETURN v_result;
END;
$$;

-- Ensure function has correct permissions
GRANT EXECUTE ON FUNCTION close_simulated_position_secure TO authenticated;

-- Add comment documenting the fix
COMMENT ON FUNCTION close_simulated_position_secure IS
  'Securely closes a simulated position with full P&L calculation and balance updates.

   CRITICAL FIX 2025-12-09: Changed status check from = ''open'' to != ''closed''
   to allow force-closing positions in ANY state (open, soft_closing, etc).

   User manual close is FINAL and should never be blocked.

   Security: Uses SECURITY DEFINER to bypass RLS, but verifies auth.uid() = position.user_id';

-- Verify the fix
DO $$
BEGIN
  RAISE NOTICE '✅ close_simulated_position_secure() updated - can now force-close ANY position status';
END $$;