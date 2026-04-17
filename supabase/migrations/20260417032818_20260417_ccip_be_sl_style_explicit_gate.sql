/*
  # Break-Even SL — Style-Explicit Gate (CCIP-2026-BE002)

  ## Summary
  Replaces the indirect `tp2_price IS NOT NULL` proxy with an explicit
  `requested_style` gate on the TP1 break-even SL move. Historical data
  proved the proxy was unreliable: one MICRO_INTRADAY trade hit TP1 but
  was left at original SL because the trigger write-path recorded
  tp1_action_taken='continued' with no BE move.

  ## Changes

  ### 1. Trigger: check_and_close_positions_on_price_update
  - SCALP: close at TP1 (unchanged behavior)
  - MICRO_INTRADAY / INTRADAY: move SL to break-even at TP1
  - Gate now keys on `requested_style` (NOT tp2_price presence)
  - Safety net: if tp1_hit=true already but sl_moved_to_breakeven_at IS NULL
    for a non-scalp, the next price tick executes the pending BE move.

  ### 2. mark_tp1_milestone RPC
  - Same style-explicit gate mirrored here.
  - SCALP via this RPC does not move SL (caller is responsible for close).

  ### 3. Fallback behavior
  - If `requested_style` is NULL on a legacy row, falls back to the old
    `tp2_price IS NOT NULL` proxy to preserve backward compatibility.

  ### Security
  No new tables — no RLS changes. Functions remain SECURITY DEFINER.
*/

CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_position RECORD;
  v_current_price NUMERIC;
  v_should_close_at_sl BOOLEAN;
  v_should_close_at_tp1 BOOLEAN;
  v_should_close_at_tp2 BOOLEAN;
  v_close_reason TEXT;
  v_close_price NUMERIC;
  v_error_message TEXT;
  v_slippage NUMERIC;
  v_atr NUMERIC;
  v_new_sl NUMERIC;
  v_be_action TEXT;
  v_is_scalp BOOLEAN;
  v_is_non_scalp BOOLEAN;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  BEGIN
    FOR v_position IN
      SELECT *
      FROM goal_session_trades
      WHERE symbol = NEW.symbol
        AND status = 'open'
    LOOP
      BEGIN

        IF v_position.direction = 'buy' THEN
          v_current_price := NEW.bid::numeric;
        ELSE
          v_current_price := NEW.ask::numeric;
        END IF;

        -- ── Style gates (SSOT: requested_style; fallback to tp2 proxy) ─────
        v_is_scalp := (
          UPPER(COALESCE(v_position.requested_style, '')) = 'SCALP'
          OR (v_position.requested_style IS NULL AND v_position.tp2_price IS NULL)
        );
        v_is_non_scalp := (
          UPPER(COALESCE(v_position.requested_style, '')) IN ('MICRO_INTRADAY', 'INTRADAY')
          OR (v_position.requested_style IS NULL AND v_position.tp2_price IS NOT NULL)
        );

        -- ── PRIORITY 1: Stop Loss ────────────────────────────────────────────
        IF v_position.stop_loss IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_sl := v_current_price <= v_position.stop_loss;
          ELSE
            v_should_close_at_sl := v_current_price >= v_position.stop_loss;
          END IF;

          IF v_should_close_at_sl THEN
            v_close_reason := 'stop_loss';
            v_close_price  := v_current_price;
            v_slippage     := ABS(v_close_price - v_position.stop_loss);

            RAISE NOTICE '[SL/TP] SL hit: trade=% symbol=% SL=% price=%',
              v_position.id, v_position.symbol, v_position.stop_loss, v_close_price;

            INSERT INTO ssot_violations (violation_type, entity_type, entity_id, expected_authority, actual_authority, severity, details)
            VALUES ('trigger_based_closure', 'goal_session_trade', v_position.id, 'alpha_coordinator', 'database_trigger', 'info',
              jsonb_build_object('close_reason', v_close_reason, 'sl_level', v_position.stop_loss, 'market_price', v_close_price, 'symbol', v_position.symbol, 'direction', v_position.direction));

            PERFORM close_goal_session_trade(v_position.id, v_close_price, v_close_reason, v_position.goal_session_id);

            INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
            VALUES (v_position.goal_session_id, v_position.user_id, 'trade_closed', 'urgent', 'Stop Loss Hit',
              format('Stop Loss triggered for %s at %s (SL: %s)', v_position.symbol, v_close_price, v_position.stop_loss),
              jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'close_price', v_close_price, 'sl_level', v_position.stop_loss, 'trigger_time', now()),
              ARRAY['in_app', 'push']);

            PERFORM _stop_session_if_last_trade(v_position.goal_session_id, v_position.user_id, v_position.id, v_close_reason);
            CONTINUE;
          END IF;
        END IF;

        -- ── PRIORITY 2: TP2 (dual TP system) ────────────────────────────────
        IF v_position.tp2_price IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp2 := v_current_price >= v_position.tp2_price;
          ELSE
            v_should_close_at_tp2 := v_current_price <= v_position.tp2_price;
          END IF;

          IF v_should_close_at_tp2 THEN
            v_close_reason := 'take_profit_2';
            v_close_price  := v_current_price;

            UPDATE goal_session_trades SET tp2_hit = true, tp2_hit_at = NOW() WHERE id = v_position.id;

            INSERT INTO ssot_violations (violation_type, entity_type, entity_id, expected_authority, actual_authority, severity, details)
            VALUES ('trigger_based_closure', 'goal_session_trade', v_position.id, 'alpha_coordinator', 'database_trigger', 'info',
              jsonb_build_object('close_reason', v_close_reason, 'tp2_level', v_position.tp2_price, 'market_price', v_close_price, 'symbol', v_position.symbol));

            PERFORM close_goal_session_trade(v_position.id, v_close_price, v_close_reason, v_position.goal_session_id);

            INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
            VALUES (v_position.goal_session_id, v_position.user_id, 'trade_closed', 'high', 'Take Profit 2 Hit!',
              format('TP2 achieved for %s at %s (TP2: %s)', v_position.symbol, v_close_price, v_position.tp2_price),
              jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'close_price', v_close_price, 'tp2_level', v_position.tp2_price, 'trigger_time', now()),
              ARRAY['in_app', 'push']);

            PERFORM _stop_session_if_last_trade(v_position.goal_session_id, v_position.user_id, v_position.id, v_close_reason);
            CONTINUE;
          END IF;
        END IF;

        -- ── PRIORITY 3a: SAFETY NET for non-scalp trades with pending BE ──
        -- If tp1_hit=true but BE SL wasn't persisted (race/crash), do it now.
        IF v_position.tp1_hit = true
           AND v_is_non_scalp
           AND v_position.sl_moved_to_breakeven_at IS NULL THEN

          RAISE NOTICE '[SL/TP] Safety-net BE move for non-scalp trade=% symbol=% (tp1_hit=true but BE not persisted)',
            v_position.id, v_position.symbol;

          SELECT AVG(high - low)
          INTO v_atr
          FROM (
            SELECT high, low
            FROM forex_candles
            WHERE symbol = v_position.symbol
              AND timeframe = 'H1'
              AND deprecated = false
              AND is_flat_candle = false
            ORDER BY open_time DESC
            LIMIT 14
          ) recent_candles;

          IF v_atr IS NULL OR v_atr <= 0 THEN
            IF v_position.symbol IN ('XAUUSD') THEN v_atr := 0.80;
            ELSIF v_position.symbol IN ('US30', 'NAS100', 'SPX500') THEN v_atr := 50.0;
            ELSIF v_position.symbol ILIKE '%JPY%' THEN v_atr := 0.08;
            ELSIF v_position.symbol IN ('BTCUSD', 'ETHUSD') THEN v_atr := 200.0;
            ELSE v_atr := 0.0005;
            END IF;
            v_be_action := 'sl_moved_to_breakeven_fallback';
          ELSE
            v_be_action := 'sl_moved_to_breakeven';
          END IF;

          IF v_position.direction = 'buy' THEN
            v_new_sl := v_position.entry_price + (v_atr * 0.10);
          ELSE
            v_new_sl := v_position.entry_price - (v_atr * 0.10);
          END IF;

          UPDATE goal_session_trades
          SET
            tp1_action_taken      = v_be_action,
            stop_loss             = v_new_sl,
            tp1_breakeven_price   = v_new_sl,
            sl_moved_to_breakeven_at = NOW()
          WHERE id = v_position.id
            AND sl_moved_to_breakeven_at IS NULL;
        END IF;

        -- ── PRIORITY 3: TP1 ──────────────────────────────────────────────────
        IF v_position.tp1_price IS NOT NULL AND v_position.tp1_hit = false THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.tp1_price;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.tp1_price;
          END IF;

          IF v_should_close_at_tp1 THEN

            IF v_is_scalp THEN
              -- SCALP: TP1 is the target — close trade (unchanged behavior)
              v_close_reason := 'take_profit_1';
              v_close_price  := v_current_price;

              UPDATE goal_session_trades
              SET tp1_hit = true, tp1_hit_at = NOW(), tp1_action_taken = 'closed_no_tp2'
              WHERE id = v_position.id;

              INSERT INTO ssot_violations (violation_type, entity_type, entity_id, expected_authority, actual_authority, severity, details)
              VALUES ('trigger_based_closure', 'goal_session_trade', v_position.id, 'alpha_coordinator', 'database_trigger', 'info',
                jsonb_build_object('close_reason', v_close_reason, 'tp1_level', v_position.tp1_price, 'market_price', v_close_price, 'style', v_position.requested_style, 'symbol', v_position.symbol));

              PERFORM close_goal_session_trade(v_position.id, v_close_price, v_close_reason, v_position.goal_session_id);

              INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
              VALUES (v_position.goal_session_id, v_position.user_id, 'trade_closed', 'high', 'Take Profit Hit!',
                format('%s closed at TP: %s', v_position.symbol, v_close_price),
                jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'close_price', v_close_price, 'tp1_level', v_position.tp1_price, 'trigger_time', now()),
                ARRAY['in_app', 'push']);

              PERFORM _stop_session_if_last_trade(v_position.goal_session_id, v_position.user_id, v_position.id, v_close_reason);
              CONTINUE;

            ELSIF v_is_non_scalp THEN
              -- MICRO_INTRADAY / INTRADAY: TP1 is a milestone — move SL to BE
              IF v_position.sl_moved_to_breakeven_at IS NOT NULL
                 OR v_position.tp1_breakeven_price IS NOT NULL THEN
                RAISE NOTICE '[SL/TP] TP1 hit (already processed, skipping BE): trade=% symbol=%',
                  v_position.id, v_position.symbol;
                CONTINUE;
              END IF;

              RAISE NOTICE '[SL/TP] TP1 hit (non-scalp %, moving SL to BE): trade=% symbol=% TP1=%',
                v_position.requested_style, v_position.id, v_position.symbol, v_position.tp1_price;

              SELECT AVG(high - low)
              INTO v_atr
              FROM (
                SELECT high, low
                FROM forex_candles
                WHERE symbol = v_position.symbol
                  AND timeframe = 'H1'
                  AND deprecated = false
                  AND is_flat_candle = false
                ORDER BY open_time DESC
                LIMIT 14
              ) recent_candles;

              IF v_atr IS NULL OR v_atr <= 0 THEN
                IF v_position.symbol IN ('XAUUSD') THEN v_atr := 0.80;
                ELSIF v_position.symbol IN ('US30', 'NAS100', 'SPX500') THEN v_atr := 50.0;
                ELSIF v_position.symbol ILIKE '%JPY%' THEN v_atr := 0.08;
                ELSIF v_position.symbol IN ('BTCUSD', 'ETHUSD') THEN v_atr := 200.0;
                ELSE v_atr := 0.0005;
                END IF;
                v_be_action := 'sl_moved_to_breakeven_fallback';
              ELSE
                v_be_action := 'sl_moved_to_breakeven';
              END IF;

              IF v_position.direction = 'buy' THEN
                v_new_sl := v_position.entry_price + (v_atr * 0.10);
              ELSE
                v_new_sl := v_position.entry_price - (v_atr * 0.10);
              END IF;

              UPDATE goal_session_trades
              SET
                tp1_hit               = true,
                tp1_hit_at            = NOW(),
                tp1_action_taken      = v_be_action,
                stop_loss             = v_new_sl,
                tp1_breakeven_price   = v_new_sl,
                sl_moved_to_breakeven_at = NOW()
              WHERE id = v_position.id;

              INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
              VALUES (v_position.goal_session_id, v_position.user_id, 'trade_update', 'high', 'Take Profit 1 Hit!',
                format('%s reached TP1 at %s. SL moved to break-even (%s). Riding to TP2...', v_position.symbol, v_position.tp1_price, round(v_new_sl::numeric, 5)),
                jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'tp1_price', v_position.tp1_price, 'current_price', v_current_price, 'new_sl', v_new_sl, 'atr_used', v_atr, 'action', v_be_action, 'style', v_position.requested_style),
                ARRAY['in_app', 'push']);
            END IF;
          END IF;
        END IF;

        -- ── PRIORITY 4: Legacy single take_profit (no tp1/tp2 columns set) ──
        IF v_position.take_profit IS NOT NULL
          AND v_position.tp1_price IS NULL
          AND v_position.tp2_price IS NULL THEN

          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.take_profit;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.take_profit;
          END IF;

          IF v_should_close_at_tp1 THEN
            v_close_reason := 'take_profit';
            v_close_price  := v_current_price;

            INSERT INTO ssot_violations (violation_type, entity_type, entity_id, expected_authority, actual_authority, severity, details)
            VALUES ('trigger_based_closure', 'goal_session_trade', v_position.id, 'alpha_coordinator', 'database_trigger', 'info',
              jsonb_build_object('close_reason', v_close_reason, 'tp_level', v_position.take_profit, 'market_price', v_close_price, 'legacy_mode', true));

            PERFORM close_goal_session_trade(v_position.id, v_close_price, v_close_reason, v_position.goal_session_id);

            INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
            VALUES (v_position.goal_session_id, v_position.user_id, 'trade_closed', 'high', 'Take Profit Hit!',
              format('Take profit reached for %s at %s', v_position.symbol, v_close_price),
              jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'close_price', v_close_price, 'tp_level', v_position.take_profit, 'trigger_time', now()),
              ARRAY['in_app', 'push']);

            PERFORM _stop_session_if_last_trade(v_position.goal_session_id, v_position.user_id, v_position.id, v_close_reason);
          END IF;
        END IF;

      EXCEPTION
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
          RAISE WARNING '[SL/TP TRIGGER] Error processing position %: %', v_position.id, v_error_message;
          BEGIN
            INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
            VALUES (v_position.goal_session_id, v_position.user_id, 'system_alert', 'high', 'SL/TP Check Error',
              format('Error checking SL/TP for %s: %s', v_position.symbol, v_error_message),
              jsonb_build_object('trade_id', v_position.id, 'error', v_error_message), ARRAY['in_app']);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
      END;
    END LOOP;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
      RAISE WARNING '[SL/TP TRIGGER] Outer error for symbol %: %', NEW.symbol, v_error_message;
  END;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_tp1_milestone RPC — style-explicit gate
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_tp1_milestone(trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade RECORD;
  v_atr NUMERIC;
  v_new_sl NUMERIC;
  v_be_action TEXT;
  v_is_scalp BOOLEAN;
  v_is_non_scalp BOOLEAN;
BEGIN
  SELECT t.* INTO v_trade
  FROM goal_session_trades AS t
  WHERE t.id = mark_tp1_milestone.trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade must be open to mark TP1', 'current_status', v_trade.status);
  END IF;

  v_is_scalp := (
    UPPER(COALESCE(v_trade.requested_style, '')) = 'SCALP'
    OR (v_trade.requested_style IS NULL AND v_trade.tp2_price IS NULL)
  );
  v_is_non_scalp := (
    UPPER(COALESCE(v_trade.requested_style, '')) IN ('MICRO_INTRADAY', 'INTRADAY')
    OR (v_trade.requested_style IS NULL AND v_trade.tp2_price IS NOT NULL)
  );

  -- Idempotent: already processed
  IF v_trade.tp1_hit = true AND (v_is_scalp OR v_trade.sl_moved_to_breakeven_at IS NOT NULL) THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'trade_id', mark_tp1_milestone.trade_id);
  END IF;

  -- SCALP via RPC: only mark the milestone (trigger is responsible for close)
  IF v_is_scalp THEN
    UPDATE goal_session_trades AS t
    SET tp1_hit = true, tp1_hit_at = COALESCE(t.tp1_hit_at, NOW()), updated_at = NOW()
    WHERE t.id = mark_tp1_milestone.trade_id;

    RETURN jsonb_build_object('success', true, 'style', 'SCALP', 'trade_id', mark_tp1_milestone.trade_id);
  END IF;

  -- Non-scalp path: move SL to BE
  IF v_trade.tp1_breakeven_price IS NOT NULL OR v_trade.sl_moved_to_breakeven_at IS NOT NULL THEN
    UPDATE goal_session_trades AS t
    SET tp1_hit = true, tp1_hit_at = COALESCE(t.tp1_hit_at, NOW()), updated_at = NOW()
    WHERE t.id = mark_tp1_milestone.trade_id;

    RETURN jsonb_build_object('success', true, 'trade_id', mark_tp1_milestone.trade_id, 'sl_already_moved', true);
  END IF;

  SELECT AVG(high - low)
  INTO v_atr
  FROM (
    SELECT high, low
    FROM forex_candles
    WHERE symbol = v_trade.symbol
      AND timeframe = 'H1'
      AND deprecated = false
      AND is_flat_candle = false
    ORDER BY open_time DESC
    LIMIT 14
  ) recent_candles;

  IF v_atr IS NULL OR v_atr <= 0 THEN
    IF v_trade.symbol IN ('XAUUSD') THEN v_atr := 0.80;
    ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500') THEN v_atr := 50.0;
    ELSIF v_trade.symbol ILIKE '%JPY%' THEN v_atr := 0.08;
    ELSIF v_trade.symbol IN ('BTCUSD', 'ETHUSD') THEN v_atr := 200.0;
    ELSE v_atr := 0.0005;
    END IF;
    v_be_action := 'sl_moved_to_breakeven_fallback';
  ELSE
    v_be_action := 'sl_moved_to_breakeven';
  END IF;

  IF v_trade.direction = 'buy' THEN
    v_new_sl := v_trade.entry_price + (v_atr * 0.10);
  ELSE
    v_new_sl := v_trade.entry_price - (v_atr * 0.10);
  END IF;

  UPDATE goal_session_trades AS t
  SET
    tp1_hit               = true,
    tp1_hit_at            = COALESCE(t.tp1_hit_at, NOW()),
    tp1_action_taken      = v_be_action,
    stop_loss             = v_new_sl,
    tp1_breakeven_price   = v_new_sl,
    sl_moved_to_breakeven_at = NOW(),
    updated_at            = NOW()
  WHERE t.id = mark_tp1_milestone.trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'style', v_trade.requested_style,
    'trade_id', mark_tp1_milestone.trade_id,
    'new_sl', v_new_sl,
    'atr_used', v_atr,
    'action', v_be_action
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION mark_tp1_milestone(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_tp1_milestone(UUID) TO service_role;
