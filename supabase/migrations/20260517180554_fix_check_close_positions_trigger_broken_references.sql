/*
  # Fix check_and_close_positions_on_price_update trigger — broken references

  1. Problem
    - The trigger calls `calculate_universal_pnl(direction, entry, exit, lot, symbol)` which does not exist.
      The correct function is `calculate_pnl_universal(symbol, direction, entry, exit, lot)`.
    - The trigger writes to `close_price` column — does not exist. Correct column is `exit_price`.
    - The trigger writes to `pnl_result` column — does not exist. Correct column is `profit_loss`.
    - These errors crash every INSERT into realtime_prices for any symbol with an open trade,
      rolling back the transaction and blocking all price data for that symbol.

  2. Impact
    - BTCUSD has zero rows in realtime_prices because of this crash
    - P&L display shows stale values because no live price data is available
    - The trigger was introduced in migration 20260517041412

  3. Fix
    - Correct function name and argument order
    - Remove non-existent `close_price` column reference (exit_price already set)
    - Replace `pnl_result` with correct column `profit_loss`
*/

CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER AS $$
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
  v_bid := NEW.bid;
  v_ask := NEW.ask;
  v_current_price := NEW.mid;

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
      v_pnl := calculate_pnl_universal(
        v_position.symbol,
        v_position.direction,
        v_position.entry_price,
        v_close_price,
        COALESCE(v_position.lot_size, v_position.position_size)
      );

      UPDATE goal_session_trades
      SET status        = 'closed',
          exit_price    = v_close_price,
          closed_at     = NOW(),
          close_reason  = v_close_reason,
          profit_loss   = COALESCE(v_position.tp1_pnl, 0) + v_pnl,
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
