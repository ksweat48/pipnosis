/*
  # Fix session_id column references in SL/TP trigger

  ## Problem
  The trigger references `v_position.session_id` and inserts into
  `goal_notifications(session_id, ...)` but:
  - `goal_session_trades` uses `goal_session_id` (not `session_id`)
  - `goal_notifications` uses `goal_session_id` (not `session_id`)
  
  These mismatches would cause runtime errors when TP1 partial close fires.
  Previously masked by the NEW.price bug preventing the TP1 code path.

  ## Fix
  Replace all `session_id` references with `goal_session_id`.
*/

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
  FOR v_position IN
    SELECT *
    FROM goal_session_trades
    WHERE symbol = NEW.symbol
      AND status = 'open'
  LOOP
    v_should_close := false;
    v_close_reason := NULL;

    v_exec_price := CASE
      WHEN v_position.direction = 'buy' THEN NEW.bid
      WHEN v_position.direction = 'sell' THEN NEW.ask
      ELSE NEW.mid
    END;

    v_close_price := v_exec_price;

    IF v_exec_price IS NULL THEN
      CONTINUE;
    END IF;

    -- ============ TP1 PARTIAL CLOSE (non-scalp dual-TP trades) ============
    IF v_position.tp1_price IS NOT NULL
       AND v_position.tp2_price IS NOT NULL
       AND v_position.tp1_hit = false
       AND COALESCE(v_position.resolved_style, '') <> 'scalp'
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
            user_id, goal_session_id, type, title, message, priority, metadata
          ) VALUES (
            v_position.user_id,
            v_position.goal_session_id,
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
  'CCIP-2026-0516-FINAL: All column references verified against actual schema. Uses NEW.bid/NEW.ask (direction-aware), resolved_style (not trade_style), goal_session_id (not session_id).';