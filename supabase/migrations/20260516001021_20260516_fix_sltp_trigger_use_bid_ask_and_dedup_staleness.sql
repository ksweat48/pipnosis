/*
  # Fix SL/TP Trigger and Price Deduplication

  ## Problem
  1. The `check_and_close_positions_on_price_update` trigger references `NEW.price`
     but the `realtime_prices` table has NO `price` column — only `bid`, `ask`, `mid`.
     This causes all SL/TP comparisons to silently fail (NULL comparisons = false).
  2. The `prevent_duplicate_prices_v2` trigger blocks inserts when the price hasn't
     moved enough, but has no time-based override. This can starve positions of
     price updates for extended periods, preventing autonomous monitors from seeing
     fresh data.

  ## Changes
  1. Rewrite `check_and_close_positions_on_price_update` to use direction-aware
     pricing: BUY positions check against `NEW.bid`, SELL positions against `NEW.ask`.
  2. Update `prevent_duplicate_prices_v2` to always allow writes if the last
     successful write was more than 10 seconds ago, regardless of price movement.

  ## Safety
  - Uses CREATE OR REPLACE (no DROP)
  - Maintains all existing TP1 partial close, SL, TP, TP2, and ATR fallback logic
  - Only changes the price reference from `NEW.price` to direction-aware `NEW.bid`/`NEW.ask`
  - Dedup change only relaxes the gate (allows more inserts, never blocks valid ones)
*/

-- 1. Fix the SL/TP trigger to use bid/ask instead of non-existent price column
CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER AS $$
DECLARE
  v_position RECORD;
  v_pnl numeric;
  v_close_price numeric;
  v_close_reason text;
  v_should_close boolean;
  v_atr numeric;
  v_be_buffer numeric;
  v_new_sl numeric;
  v_partial_pct numeric;
  v_orig_lot numeric;
  v_closed_lot numeric;
  v_remaining_lot numeric;
  v_tp1_pnl numeric;
  v_exec_price numeric;
BEGIN
  -- iterate open positions for this symbol
  FOR v_position IN
    SELECT *
    FROM goal_session_trades
    WHERE symbol = NEW.symbol
      AND status = 'open'
  LOOP
    v_should_close := false;
    v_close_reason := NULL;

    -- Direction-aware execution price:
    -- BUY positions close at bid, SELL positions close at ask
    v_exec_price := CASE
      WHEN v_position.direction = 'buy' THEN NEW.bid
      WHEN v_position.direction = 'sell' THEN NEW.ask
      ELSE NEW.mid
    END;

    v_close_price := v_exec_price;

    -- Skip if we couldn't determine a valid execution price
    IF v_exec_price IS NULL THEN
      CONTINUE;
    END IF;

    -- ============ TP1 PARTIAL CLOSE (non-scalp dual-TP trades) ============
    IF v_position.tp1_price IS NOT NULL
       AND v_position.tp2_price IS NOT NULL
       AND v_position.tp1_hit = false
       AND COALESCE(v_position.trade_style, '') <> 'scalp'
    THEN
      IF (v_position.direction = 'buy'  AND v_exec_price >= v_position.tp1_price)
      OR (v_position.direction = 'sell' AND v_exec_price <= v_position.tp1_price)
      THEN
        v_partial_pct := COALESCE(v_position.partial_close_pct, 0.5);
        v_orig_lot    := COALESCE(v_position.original_lot_size, v_position.lot_size, v_position.position_size);
        v_closed_lot  := v_orig_lot * v_partial_pct;
        v_remaining_lot := v_orig_lot - v_closed_lot;

        IF v_remaining_lot >= 0.01 THEN
          v_tp1_pnl := calculate_universal_pnl(
            v_position.direction,
            v_position.entry_price,
            v_position.tp1_price,
            v_closed_lot,
            v_position.symbol
          );

          v_be_buffer := CASE
            WHEN v_position.symbol IN ('XAUUSD') THEN 0.50
            WHEN v_position.symbol IN ('US30', 'NAS100') THEN 5.0
            WHEN v_position.symbol IN ('BTCUSD') THEN 50.0
            WHEN v_position.symbol IN ('ETHUSD') THEN 5.0
            ELSE 0.0005
          END;

          v_new_sl := CASE
            WHEN v_position.direction = 'buy'  THEN v_position.entry_price + v_be_buffer
            ELSE v_position.entry_price - v_be_buffer
          END;

          UPDATE goal_session_trades
          SET tp1_hit = true,
              tp1_hit_at = NOW(),
              tp1_pnl = v_tp1_pnl,
              original_lot_size = COALESCE(original_lot_size, v_orig_lot),
              lot_size = v_remaining_lot,
              position_size = v_remaining_lot,
              stop_loss = v_new_sl,
              updated_at = NOW()
          WHERE id = v_position.id
            AND tp1_hit = false;

          INSERT INTO goal_notifications (
            user_id, session_id, type, title, message, priority, metadata
          ) VALUES (
            v_position.user_id,
            v_position.session_id,
            'tp1_partial_close',
            'TP1 Hit — Profit Locked',
            format(
              '%s %s: TP1 hit at %s. Closed %s%% (%s lots) for $%s. Runner %s lots continues to TP2 with SL at breakeven.',
              UPPER(v_position.direction), v_position.symbol,
              v_position.tp1_price,
              ROUND(v_partial_pct * 100)::text,
              ROUND(v_closed_lot::numeric, 2)::text,
              ROUND(v_tp1_pnl::numeric, 2)::text,
              ROUND(v_remaining_lot::numeric, 2)::text
            ),
            'high',
            jsonb_build_object(
              'trade_id', v_position.id,
              'tp1_price', v_position.tp1_price,
              'tp1_pnl', v_tp1_pnl,
              'partial_close_pct', v_partial_pct,
              'original_lot', v_orig_lot,
              'closed_lot', v_closed_lot,
              'remaining_lot', v_remaining_lot,
              'new_stop_loss', v_new_sl
            )
          );

          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- ============ STOP LOSS ============
    IF v_position.stop_loss IS NOT NULL THEN
      IF (v_position.direction = 'buy'  AND v_exec_price <= v_position.stop_loss)
      OR (v_position.direction = 'sell' AND v_exec_price >= v_position.stop_loss)
      THEN
        v_should_close := true;
        v_close_price  := v_position.stop_loss;
        v_close_reason := 'stop_loss';
      END IF;
    END IF;

    -- ============ TAKE PROFIT (single-TP / scalp / runner TP2) ============
    IF NOT v_should_close THEN
      IF v_position.tp2_price IS NOT NULL AND v_position.tp1_hit = true THEN
        IF (v_position.direction = 'buy'  AND v_exec_price >= v_position.tp2_price)
        OR (v_position.direction = 'sell' AND v_exec_price <= v_position.tp2_price)
        THEN
          v_should_close := true;
          v_close_price  := v_position.tp2_price;
          v_close_reason := 'take_profit_2';
        END IF;
      ELSIF v_position.take_profit IS NOT NULL THEN
        IF (v_position.direction = 'buy'  AND v_exec_price >= v_position.take_profit)
        OR (v_position.direction = 'sell' AND v_exec_price <= v_position.take_profit)
        THEN
          v_should_close := true;
          v_close_price  := v_position.take_profit;
          v_close_reason := 'take_profit';
        END IF;
      END IF;
    END IF;

    -- ============ EMERGENCY ATR FALLBACK (no SL set) ============
    IF NOT v_should_close AND v_position.stop_loss IS NULL THEN
      v_atr := CASE
        WHEN v_position.symbol = 'XAUUSD' THEN 5.0
        WHEN v_position.symbol IN ('US30', 'NAS100') THEN 50.0
        WHEN v_position.symbol = 'BTCUSD' THEN 500.0
        WHEN v_position.symbol = 'ETHUSD' THEN 50.0
        WHEN v_position.symbol IN ('USOIL', 'UKOIL') THEN 1.0
        ELSE 0.005
      END;

      IF (v_position.direction = 'buy'  AND v_exec_price <= v_position.entry_price - (v_atr * 3))
      OR (v_position.direction = 'sell' AND v_exec_price >= v_position.entry_price + (v_atr * 3))
      THEN
        v_should_close := true;
        v_close_reason := 'emergency_atr_stop';
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
          updated_at    = NOW()
      WHERE id = v_position.id
        AND status = 'open';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'CCIP-2026-0516: Fixed to use NEW.bid/NEW.ask (direction-aware) instead of non-existent NEW.price column. BUY positions evaluated at bid, SELL at ask.';


-- 2. Fix the dedup trigger to allow time-based writes (max 10s staleness)
CREATE OR REPLACE FUNCTION prevent_duplicate_prices_v2()
RETURNS TRIGGER AS $$
DECLARE
  v_recent_price        RECORD;
  v_last_saved_time     timestamptz;
  v_price_diff          NUMERIC;
  v_min_change_threshold NUMERIC;
BEGIN
  /*
   * CCIP SSOT: Instrument-class-aware deduplication gate.
   *
   * Thresholds are calibrated per instrument price scale so that normal
   * tick-to-tick movement is not misidentified as a duplicate:
   *
   *   Crypto  (1k-250k price range):  0.001%  -- high volatility, fast ticks
   *   Indices (5k-55k  price range):  0.05%   -- slower tick movement relative to price
   *   Forex   (0.5-200 price range):  0.0001% -- very precise instruments
   */
  IF NEW.symbol IN ('BTCUSD', 'ETHUSD') THEN
    v_min_change_threshold := 0.00001;  -- 0.001% for crypto
  ELSIF NEW.symbol IN ('SPX500', 'NAS100', 'US30') THEN
    v_min_change_threshold := 0.0005;   -- 0.05% for equity indices
  ELSE
    v_min_change_threshold := 0.000001; -- 0.0001% for forex/gold/silver
  END IF;

  -- Check when this symbol was last successfully written
  SELECT MAX(created_at) INTO v_last_saved_time
  FROM realtime_prices
  WHERE symbol = NEW.symbol;

  -- No existing rows for this symbol: always allow (first write)
  IF v_last_saved_time IS NULL OR v_last_saved_time < NOW() - INTERVAL '30 seconds' THEN
    RETURN NEW;
  END IF;

  -- CRITICAL FIX: Always allow writes if last write was more than 10 seconds ago.
  -- This prevents positions from being starved of price updates during low-volatility
  -- periods where the price barely moves. SL/TP triggers and P&L updates depend on
  -- fresh rows being inserted into this table.
  IF v_last_saved_time < NOW() - INTERVAL '10 seconds' THEN
    RETURN NEW;
  END IF;

  -- Symbol has a recent write within 10 seconds: check if price has moved enough
  SELECT bid, ask INTO v_recent_price
  FROM realtime_prices
  WHERE symbol = NEW.symbol
    AND created_at > NOW() - INTERVAL '5 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  -- No write in the last 5 seconds: allow
  IF v_recent_price IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate percentage price difference vs most recent stored tick
  v_price_diff := ABS((NEW.bid - v_recent_price.bid) / NULLIF(v_recent_price.bid, 0));

  -- Price has not moved enough: discard to prevent flooding
  IF v_price_diff < v_min_change_threshold THEN
    RETURN NULL;
  END IF;

  -- Price has moved sufficiently: allow insert
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_duplicate_prices_v2() IS
  'CCIP-2026-0516: Added 10-second staleness override to prevent price starvation during low-volatility periods. Positions need fresh price rows for SL/TP triggers to fire.';