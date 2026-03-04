/*
  # Wire record_trade_achievement into close_goal_session_trade

  ## Summary
  Modifies the close_goal_session_trade RPC to automatically call
  record_trade_achievement whenever a trade closes with positive P&L.
  This is the SSOT insertion point — no other code path inserts achievements.

  ## Change
  After the trade row is updated and balance is recalculated, if v_calculated_pnl > 0,
  record_trade_achievement is called with the trade's metadata.
*/

CREATE OR REPLACE FUNCTION public.close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL,
  p_force_close boolean DEFAULT false,
  p_closed_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_price_diff numeric;
  v_pip_value numeric;
  v_result jsonb;
  v_rows_updated integer;
  v_event_id uuid;
  v_actual_closed_at timestamptz;
  v_effective_lot numeric;
  v_achievement_id uuid;
BEGIN
  v_actual_closed_at := COALESCE(p_closed_at, now());

  IF p_close_reason NOT IN (
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'timeout', 'weekend_protection', 'force_closed', 'goal_expired',
    'session_ended', 'risk_limit', 'trailing_stop', 'holiday_closure', 'market_closed'
  ) THEN
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
    post_processing_status = 'pending'
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
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance for user %', v_trade.user_id;
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance != v_new_balance THEN
    RAISE EXCEPTION '[close_goal_session_trade] Balance verification failed for user %', v_trade.user_id;
  END IF;

  RAISE LOG '[close_goal_session_trade] Balance updated: $% -> $%',
    v_current_balance - v_calculated_pnl, v_current_balance;

  -- ACHIEVEMENT: record per-trade win automatically for all profitable closures
  IF v_calculated_pnl > 0 THEN
    BEGIN
      SELECT record_trade_achievement(
        v_trade.user_id,
        v_trade.id,
        v_trade.symbol,
        COALESCE(v_trade.direction, v_trade.position_type, 'BUY'),
        v_calculated_pnl,
        p_close_reason,
        COALESCE(v_trade.total_pips, 0),
        COALESCE(v_trade.lot_size, 0),
        COALESCE(v_trade.alpha_style, '')
      ) INTO v_achievement_id;
      RAISE LOG '[close_goal_session_trade] Achievement recorded: %', v_achievement_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[close_goal_session_trade] Achievement recording failed (non-fatal): %', SQLERRM;
    END;
  END IF;

  INSERT INTO trade_closure_events (
    trade_id, user_id, goal_session_id, symbol, direction,
    close_price, close_reason, pnl,
    last_processed_at, post_processing_status, event_triggered_by
  ) VALUES (
    v_trade.id, v_trade.user_id, v_trade.goal_session_id, v_trade.symbol,
    COALESCE(v_trade.direction, v_trade.position_type),
    p_close_price, p_close_reason, v_calculated_pnl,
    NULL, 'pending', 'rpc'
  ) RETURNING id INTO v_event_id;

  RAISE LOG '[close_goal_session_trade] Event emitted: %', v_event_id;

  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance - v_calculated_pnl,
    'balance_after', v_current_balance,
    'event_id', v_event_id,
    'closed_at', v_actual_closed_at,
    'stop_loss', v_trade.stop_loss,
    'take_profit', v_trade.take_profit,
    'achievement_id', v_achievement_id
  );

  RETURN v_result;
END;
$$;
