/*
  # Fix close_goal_session_trade RPC Close Reason Validation Mismatch

  1. Problem
    - Migration 20260517 rewrote the function with new close reason names
      (e.g., 'manual_close' instead of 'manual', 'weekend_close' instead of 'weekend_protection')
    - Frontend sends 'manual' but RPC only accepts 'manual_close'
    - Table CHECK constraints still use the original names ('manual', 'weekend_protection', etc.)
    - Result: users cannot close positions manually — RPC rejects 'manual' with HTTP 400

  2. Fix Applied
    - Rebuild close_goal_session_trade with v_valid_reasons that includes BOTH
      the frontend/table-constraint names AND the new names introduced in 20260517
    - This ensures backwards compatibility with existing code while allowing
      any close reason that either the frontend or server-side triggers might send

  3. Table Constraint Updates
    - Add new close reasons to the table CHECK constraints so that
      server-side triggers (emergency_atr_stop, entry_edge_loss, breakeven_stop, etc.)
      can write their close reasons without constraint violations

  4. SSOT Compliance
    - The table CHECK constraint is the ultimate authority on what values the column accepts
    - The RPC function validation is a fast-fail guard, not the source of truth
    - Both must be aligned
*/

-- ============================================================
-- STEP 1: Update table CHECK constraints to include all valid reasons
-- ============================================================

-- Drop the old constraints
ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS close_reason_ssot;
ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS goal_session_trades_close_reason_check;

-- Create single unified constraint with all valid close reasons
ALTER TABLE goal_session_trades ADD CONSTRAINT close_reason_ssot CHECK (
  close_reason IS NULL OR close_reason = ANY(ARRAY[
    -- Core frontend reasons (SSOT - what the UI sends)
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop',
    'weekend_protection', 'holiday_closure', 'force_closed', 'market_closed',
    -- Server-side trigger reasons
    'emergency_atr_stop', 'entry_edge_loss', 'breakeven_stop', 'system_close',
    -- Legacy/alternative names (backwards compatibility)
    'goal_met', 'timeout', 'safety_net', 'user_stopped', 'breakeven',
    'alpha_override', 'ai_decision', 'weekend_shutdown', 'force_close',
    'manual_close', 'session_timeout', 'weekend_close', 'holiday_close',
    'market_close', 'emergency_close', 'admin_close'
  ]::text[])
);

-- ============================================================
-- STEP 2: Recreate close_goal_session_trade with corrected validation
-- ============================================================

DROP FUNCTION IF EXISTS close_goal_session_trade(UUID, NUMERIC, TEXT, UUID, BOOLEAN, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id UUID,
  p_close_price NUMERIC,
  p_close_reason TEXT,
  p_goal_session_id UUID DEFAULT NULL,
  p_force_close BOOLEAN DEFAULT false,
  p_closed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade RECORD;
  v_calculated_pnl NUMERIC;
  v_price_diff NUMERIC;
  v_pip_value NUMERIC;
  v_effective_lot NUMERIC;
  v_current_balance NUMERIC;
  v_new_balance NUMERIC;
  v_rows_updated INTEGER;
  v_actual_closed_at TIMESTAMPTZ := COALESCE(p_closed_at, now());
  v_valid_reasons TEXT[] := ARRAY[
    -- Core frontend reasons
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop',
    'weekend_protection', 'holiday_closure', 'force_closed', 'market_closed',
    -- Server-side trigger reasons
    'emergency_atr_stop', 'entry_edge_loss', 'breakeven_stop', 'system_close',
    -- Alternative names (some server code uses these)
    'force_close', 'manual_close', 'session_timeout', 'weekend_close',
    'holiday_close', 'market_close', 'emergency_close', 'admin_close', 'timeout'
  ];
BEGIN
  IF p_close_reason IS NULL OR NOT (p_close_reason = ANY(v_valid_reasons)) THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade % (force: %, reason: %)', p_trade_id, p_force_close, p_close_reason;

  IF p_force_close THEN
    IF p_goal_session_id IS NOT NULL THEN
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND goal_session_id = p_goal_session_id AND status != 'closed';
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND status != 'closed';
    END IF;
  ELSE
    IF p_goal_session_id IS NOT NULL THEN
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND goal_session_id = p_goal_session_id AND status IN ('open', 'pending', 'soft_closing');
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND status IN ('open', 'pending', 'soft_closing');
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade % not found or already closed', p_trade_id;
  END IF;

  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied for trade %', p_trade_id;
  END IF;

  v_price_diff := p_close_price - v_trade.entry_price;
  v_effective_lot := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);

  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_value := (v_price_diff / 0.01) * (v_effective_lot * 10);
  ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX')
     OR v_trade.symbol LIKE 'US30%'
     OR v_trade.symbol LIKE 'NAS100%'
     OR v_trade.symbol LIKE 'SPX500%' THEN
    v_pip_value := v_price_diff * v_effective_lot * 100;
  ELSIF v_trade.symbol LIKE '%XAU%' OR v_trade.symbol LIKE '%GOLD%' THEN
    v_pip_value := v_price_diff * v_effective_lot * 100;
  ELSIF v_trade.symbol LIKE '%XAG%' OR v_trade.symbol LIKE '%SILVER%' THEN
    v_pip_value := v_price_diff * v_effective_lot * 5.0;
  ELSIF v_trade.symbol LIKE '%BTC%' OR v_trade.symbol LIKE '%ETH%' OR v_trade.symbol LIKE '%CRYPTO%' THEN
    v_pip_value := v_price_diff * v_effective_lot;
  ELSE
    v_pip_value := (v_price_diff / 0.0001) * (v_effective_lot * 10);
  END IF;

  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_value;
  ELSE
    v_calculated_pnl := -v_pip_value;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  IF ABS(v_calculated_pnl) > 50000 THEN
    RAISE WARNING '[close_goal_session_trade] EXTREME P&L DETECTED: $% for % (lot: %, entry: %, exit: %). Proceeding but flagging for review.',
      v_calculated_pnl, v_trade.symbol, v_effective_lot, v_trade.entry_price, p_close_price;
  END IF;

  RAISE LOG '[close_goal_session_trade] Symbol: %, Entry: %, Exit: %, Lot: %, PNL: $%',
    v_trade.symbol, v_trade.entry_price, p_close_price, v_effective_lot, v_calculated_pnl;

  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = v_actual_closed_at,
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now(),
    last_processed_at = NULL,
    post_processing_status = 'pending',
    tp1_hit = CASE
      WHEN p_close_reason IN ('take_profit_1', 'take_profit_2') THEN true
      ELSE tp1_hit
    END,
    tp1_hit_at = CASE
      WHEN p_close_reason IN ('take_profit_1', 'take_profit_2') AND tp1_hit_at IS NULL THEN v_actual_closed_at
      ELSE tp1_hit_at
    END,
    tp2_hit = CASE
      WHEN p_close_reason = 'take_profit_2' THEN true
      ELSE tp2_hit
    END,
    tp2_hit_at = CASE
      WHEN p_close_reason = 'take_profit_2' AND tp2_hit_at IS NULL THEN v_actual_closed_at
      ELSE tp2_hit_at
    END
  WHERE id = p_trade_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update trade %', p_trade_id;
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found for user %', v_trade.user_id;
  END IF;

  v_new_balance := v_current_balance + v_calculated_pnl;

  UPDATE user_profiles
  SET account_balance = v_new_balance, updated_at = now()
  WHERE id = v_trade.user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update user balance for user %', v_trade.user_id;
  END IF;

  RAISE LOG '[close_goal_session_trade] Trade % closed. PnL: $%, New balance: $%', p_trade_id, v_calculated_pnl, v_new_balance;

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'pnl', v_calculated_pnl,
    'new_balance', v_new_balance,
    'close_reason', p_close_reason,
    'closed_at', v_actual_closed_at
  );
END;
$$;

COMMENT ON FUNCTION close_goal_session_trade IS
  'CCIP-2026-0525: Fixed close reason validation mismatch. Accepts both frontend names (manual, weekend_protection, etc.) and server-side names (manual_close, weekend_close, etc.).';
