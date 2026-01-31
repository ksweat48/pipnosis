/*
  # Enhance close_goal_session_trade() RPC to Emit Events

  ## Purpose
  Adds event emission to the existing close_goal_session_trade() RPC function.
  When a trade is successfully closed, an event is inserted into the trade_closure_events queue
  for processing by both the browser coordinator (realtime) and server edge function (batch).

  ## Changes
  1. RPC enhanced with event insertion
  2. Event emitted after successful trade closure
  3. All existing logic preserved (backward compatible)
  4. ACID transaction: event insertion failure = entire closure fails

  ## Event Emission
  - Event contains: trade_id, user_id, session_id, symbol, close_price, pnl, close_reason
  - Event marked with last_processed_at=NULL (unprocessed) and post_processing_status='pending'
  - Event inserted within same transaction as trade closure
  - If insertion fails, entire RPC fails (ACID safety)
*/

-- Drop existing function to allow recreation with enhanced logic
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid) CASCADE;

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
  v_price_diff numeric;
  v_pip_value numeric;
  v_result jsonb;
  v_rows_updated integer;
  v_event_id uuid;
BEGIN
  -- Validate close_reason enum
  IF p_close_reason NOT IN (
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'timeout', 'weekend_protection', 'force_closed', 'goal_expired',
    'session_ended', 'risk_limit', 'trailing_stop', 'holiday_closure', 'market_closed'
  ) THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade %', p_trade_id;

  -- Fetch trade with proper status checks
  IF p_goal_session_id IS NOT NULL THEN
    SELECT * INTO v_trade FROM goal_session_trades 
    WHERE id = p_trade_id 
      AND goal_session_id = p_goal_session_id 
      AND status IN ('open', 'pending', 'soft_closing');
  ELSE
    SELECT * INTO v_trade FROM goal_session_trades 
    WHERE id = p_trade_id 
      AND status IN ('open', 'pending', 'soft_closing');
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade not found or already closed';
  END IF;

  -- Validate user access
  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied';
  END IF;

  -- Calculate price difference
  v_price_diff := p_close_price - v_trade.entry_price;

  -- Calculate P&L based on instrument type (SSOT)
  IF v_trade.symbol LIKE '%JPY%' THEN
    -- JPY pairs: 0.01 = 1 pip, $1000 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000);
  ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX') OR v_trade.symbol LIKE 'US30%' OR v_trade.symbol LIKE 'NAS100%' OR v_trade.symbol LIKE 'SPX500%' THEN
    -- Indices: 1 point = 1 pip, $1 per 1.0 lot
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSIF v_trade.symbol LIKE '%XAU%' OR v_trade.symbol LIKE '%GOLD%' THEN
    -- Gold: 0.01 = 1 pip, $100 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 100);
  ELSIF v_trade.symbol LIKE '%BTC%' OR v_trade.symbol LIKE '%ETH%' OR v_trade.symbol LIKE '%CRYPTO%' THEN
    -- Crypto: Direct price difference, $1 per 1.0 contract
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSE
    -- Standard Forex: 0.0001 = 1 pip, $10 per 1.0 lot
    v_pip_value := (v_price_diff / 0.0001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10);
  END IF;

  -- Apply direction (buy = positive when price up, sell = positive when price down)
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_value;
  ELSE
    v_calculated_pnl := -v_pip_value;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  RAISE LOG '[close_goal_session_trade] Symbol: %, Entry: %, Exit: %, Lot: %, Calculated PNL: %', 
    v_trade.symbol, v_trade.entry_price, p_close_price, v_trade.lot_size, v_calculated_pnl;

  -- STAGE 2: Mutate - Update trade
  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
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
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update trade';
  END IF;

  -- Fetch current balance
  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found';
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + v_calculated_pnl;

  -- Update balance
  UPDATE user_profiles 
  SET account_balance = v_new_balance, updated_at = now() 
  WHERE id = v_trade.user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance';
  END IF;

  -- Verify balance update
  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance != v_new_balance THEN
    RAISE EXCEPTION '[close_goal_session_trade] Balance verification failed';
  END IF;

  RAISE LOG '[close_goal_session_trade] Trade closed successfully. Balance updated from % to %', 
    v_current_balance - v_calculated_pnl, v_current_balance;

  -- CRITICAL: Emit event to post-processing queue
  -- This event will be picked up by:
  --   1. Browser coordinator (via realtime subscription)
  --   2. Server edge function (via periodic polling)
  -- The event is transactional: if it fails, entire closure fails (ACID safety)
  INSERT INTO trade_closure_events (
    trade_id,
    user_id,
    goal_session_id,
    symbol,
    direction,
    close_price,
    close_reason,
    pnl,
    last_processed_at,
    post_processing_status,
    event_triggered_by
  ) VALUES (
    v_trade.id,
    v_trade.user_id,
    v_trade.goal_session_id,
    v_trade.symbol,
    COALESCE(v_trade.direction, v_trade.position_type),
    p_close_price,
    p_close_reason,
    v_calculated_pnl,
    NULL,
    'pending',
    'rpc'
  ) RETURNING id INTO v_event_id;

  RAISE LOG '[close_goal_session_trade] Event emitted with ID %', v_event_id;

  -- Build result
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
    'event_id', v_event_id
  );

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO service_role;
