/*
  # Fix TP2 Hit Not Marked When Trade Closes at Take Profit 2

  1. Problem
    - Trade closes with close_reason='take_profit_2' but tp2_hit remains false
    - UI displays "TP2 Missed" even though trade literally closed at TP2
    - Root cause: close_goal_session_trade RPC and check_and_close_positions_on_price_update
      trigger both fail to set tp2_hit=true when close_reason is take_profit_2

  2. Fix Applied
    - close_goal_session_trade RPC: adds tp2_hit/tp2_hit_at (and tp1_hit/tp1_hit_at)
      conditional on close_reason
    - check_and_close_positions_on_price_update trigger: adds tp2_hit=true when
      v_close_reason='take_profit_2', tp1_hit=true when v_close_reason in (tp1, tp2)

  3. Backfill
    - Updates all historical trades where close_reason='take_profit_2' but tp2_hit=false
    - Updates all historical trades where close_reason in ('take_profit_1','take_profit_2') but tp1_hit=false

  4. SSOT Compliance
    - close_reason is the authoritative record of what happened
    - tp1_hit/tp2_hit must be consistent with close_reason
*/

-- ============================================================
-- FIX 1: close_goal_session_trade RPC — set tp1_hit/tp2_hit
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
    'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'manual_close', 'session_timeout', 'weekend_close', 'goal_achieved',
    'force_close', 'emergency_close', 'admin_close', 'holiday_close',
    'market_close', 'system_close', 'breakeven_stop', 'trailing_stop',
    'emergency_atr_stop', 'entry_edge_loss'
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

-- ============================================================
-- FIX 2: check_and_close_positions_on_price_update trigger
-- Add tp1_hit/tp2_hit to the EXECUTE CLOSE UPDATE block
-- ============================================================
CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position RECORD;
  v_close_price NUMERIC;
  v_should_close BOOLEAN := false;
  v_close_reason TEXT := NULL;
  v_pnl NUMERIC;
  v_current_price NUMERIC;
  v_bid NUMERIC;
  v_ask NUMERIC;
  v_atr NUMERIC;
  v_emergency_atr_multiplier NUMERIC := 3.0;
BEGIN
  v_bid := COALESCE(NEW.bid, NEW.price);
  v_ask := COALESCE(NEW.ask, NEW.price);
  v_current_price := NEW.price;

  FOR v_position IN
    SELECT gst.*
    FROM goal_session_trades gst
    WHERE gst.symbol = NEW.symbol
      AND gst.status = 'open'
  LOOP
    v_should_close := false;
    v_close_reason := NULL;

    IF v_position.direction = 'buy' OR v_position.position_type = 'buy' THEN
      v_close_price := v_bid;

      IF v_position.stop_loss IS NOT NULL AND v_close_price <= v_position.stop_loss THEN
        v_should_close := true;
        v_close_reason := 'stop_loss';
      END IF;

      IF NOT v_should_close AND v_position.tp2_price IS NOT NULL AND v_close_price >= v_position.tp2_price THEN
        v_should_close := true;
        v_close_reason := 'take_profit_2';
      ELSIF NOT v_should_close AND v_position.take_profit IS NOT NULL AND v_close_price >= v_position.take_profit THEN
        v_should_close := true;
        v_close_reason := CASE
          WHEN v_position.tp1_price IS NOT NULL THEN 'take_profit_2'
          ELSE 'take_profit'
        END;
      ELSIF NOT v_should_close AND v_position.tp1_price IS NOT NULL AND NOT COALESCE(v_position.tp1_hit, false) AND v_close_price >= v_position.tp1_price THEN
        UPDATE goal_session_trades
        SET tp1_hit = true, tp1_hit_at = NOW(), updated_at = NOW()
        WHERE id = v_position.id AND NOT COALESCE(tp1_hit, false);
      END IF;
    ELSE
      v_close_price := v_ask;

      IF v_position.stop_loss IS NOT NULL AND v_close_price >= v_position.stop_loss THEN
        v_should_close := true;
        v_close_reason := 'stop_loss';
      END IF;

      IF NOT v_should_close AND v_position.tp2_price IS NOT NULL AND v_close_price <= v_position.tp2_price THEN
        v_should_close := true;
        v_close_reason := 'take_profit_2';
      ELSIF NOT v_should_close AND v_position.take_profit IS NOT NULL AND v_close_price <= v_position.take_profit THEN
        v_should_close := true;
        v_close_reason := CASE
          WHEN v_position.tp1_price IS NOT NULL THEN 'take_profit_2'
          ELSE 'take_profit'
        END;
      ELSIF NOT v_should_close AND v_position.tp1_price IS NOT NULL AND NOT COALESCE(v_position.tp1_hit, false) AND v_close_price <= v_position.tp1_price THEN
        UPDATE goal_session_trades
        SET tp1_hit = true, tp1_hit_at = NOW(), updated_at = NOW()
        WHERE id = v_position.id AND NOT COALESCE(tp1_hit, false);
      END IF;
    END IF;

    IF NOT v_should_close AND v_position.stop_loss IS NOT NULL THEN
      v_atr := NULL;
      SELECT atr_value INTO v_atr FROM forex_candles
      WHERE symbol = NEW.symbol AND timeframe = 'M5'
      ORDER BY open_time DESC LIMIT 1;

      IF v_atr IS NOT NULL AND v_atr > 0 THEN
        IF (v_position.direction = 'buy' OR v_position.position_type = 'buy') THEN
          IF v_close_price <= (v_position.entry_price - (v_atr * v_emergency_atr_multiplier)) THEN
            v_should_close := true;
            v_close_reason := 'emergency_atr_stop';
          END IF;
        ELSE
          IF v_close_price >= (v_position.entry_price + (v_atr * v_emergency_atr_multiplier)) THEN
            v_should_close := true;
            v_close_reason := 'emergency_atr_stop';
          END IF;
        END IF;
      END IF;
    END IF;

    -- ============ EXECUTE CLOSE ============
    IF v_should_close THEN
      v_pnl := calculate_universal_pnl(
        v_position.direction,
        v_position.entry_price,
        v_close_price,
        COALESCE(v_position.lot_size, v_position.position_size),
        v_position.symbol
      );

      UPDATE goal_session_trades
      SET status        = 'closed',
          exit_price    = v_close_price,
          close_price   = v_close_price,
          closed_at     = NOW(),
          close_reason  = v_close_reason,
          pnl_result    = COALESCE(v_position.tp1_pnl, 0) + v_pnl,
          tp2_pnl       = CASE WHEN v_close_reason = 'take_profit_2' THEN v_pnl ELSE NULL END,
          tp1_hit       = CASE WHEN v_close_reason IN ('take_profit_1', 'take_profit_2') THEN true ELSE tp1_hit END,
          tp1_hit_at    = CASE WHEN v_close_reason IN ('take_profit_1', 'take_profit_2') AND tp1_hit_at IS NULL THEN NOW() ELSE tp1_hit_at END,
          tp2_hit       = CASE WHEN v_close_reason = 'take_profit_2' THEN true ELSE tp2_hit END,
          tp2_hit_at    = CASE WHEN v_close_reason = 'take_profit_2' AND tp2_hit_at IS NULL THEN NOW() ELSE tp2_hit_at END,
          updated_at    = NOW()
      WHERE id = v_position.id
        AND status = 'open';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'CCIP-2026-0517B: Fixed tp2_hit/tp1_hit not being set when trade closes at TP2/TP1. Uses NEW.bid/NEW.ask (direction-aware).';

-- ============================================================
-- FIX 3: Backfill historical trades
-- ============================================================

UPDATE goal_session_trades
SET tp2_hit = true,
    tp2_hit_at = COALESCE(tp2_hit_at, closed_at),
    updated_at = now()
WHERE close_reason = 'take_profit_2'
  AND status = 'closed'
  AND (tp2_hit IS NULL OR tp2_hit = false);

UPDATE goal_session_trades
SET tp1_hit = true,
    tp1_hit_at = COALESCE(tp1_hit_at, closed_at),
    updated_at = now()
WHERE close_reason IN ('take_profit_1', 'take_profit_2')
  AND status = 'closed'
  AND (tp1_hit IS NULL OR tp1_hit = false);
