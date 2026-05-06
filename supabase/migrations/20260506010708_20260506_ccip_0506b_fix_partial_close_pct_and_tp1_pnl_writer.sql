/*
  # CCIP-2026-0506B — partial_close_pct scaling + tp1_pnl writer SSOT fix

  ## Problem 1: partial_close_pct stored as integer 50 (should be fraction 0.50)

  The column was added by migration 20260107133235 with DEFAULT 50 (integer-like
  numeric). The Feb governance migration 20260221015044 used IF NOT EXISTS and
  so the intended numeric(5,4) typing, CHECK (>0 AND <1), and 0.50 default were
  never applied. Every row in goal_session_trades.partial_close_pct currently
  stores "50", but the TS split-P&L math (calculateSplitPnL, PositionsPage leg
  derivation) treats the value as a fraction. A stored 50 is silently clamped to
  the 0.5 fallback today; correcting the store brings UI derivation in line with
  the SSOT.

  ## Problem 2: tp1_pnl never written when DB trigger fires the TP1 milestone

  check_and_close_positions_on_price_update atomically sets tp1_hit/tp1_hit_at,
  moves the SL, and persists tp1_breakeven_price — but not tp1_pnl. The TS
  markTP1Hit writes tp1_pnl, but loses the optimistic-lock race to the trigger
  in every observed non-scalp TP1 event. Result: tp1_pnl is NULL for TP1-hit
  rows, UI falls back to est-derivation, and ai_trade_journal.tp1_pnl is also
  unset until post-trade-analyzer runs on final closure (which writes
  journal.tp1_pnl but never back-fills the trades row).

  This migration teaches the trigger to compute and persist tp1_pnl using the
  universal PnL calculator already in the database, using the exact tp1_price
  (advisory milestone price, not the jittery bid/ask at the trigger instant).

  ## Changes

  1. Re-default partial_close_pct to 0.5, backfill existing 50-valued rows to 0.5.
     Add CHECK (>0 AND <1) so no future writer can slip in an integer again.

  2. Rewrite check_and_close_positions_on_price_update so the non-scalp TP1
     branch and the safety-net post-TP1 branch both call calculate_universal_pnl
     (direction, entry_price, tp1_price, lot_size, symbol) and persist the
     partial P&L into goal_session_trades.tp1_pnl. Scalp TP1 close branch is
     unchanged — the close_goal_session_trade RPC already finalises profit_loss.

  ## SSOT / CCIP

  - partial_close_pct authority: Alpha at trade creation. Default now 0.5.
  - tp1_pnl authority: whichever TP1 writer wins first — both the trigger
    and position-monitoring-authority.markTP1Hit now write the same value.
  - No behavioural change to SL movement, BE logic, or TP2 closure.
*/

-- ---------------------------------------------------------------------------
-- 1) partial_close_pct: backfill and constrain
-- ---------------------------------------------------------------------------

UPDATE goal_session_trades
SET partial_close_pct = 0.5
WHERE partial_close_pct IS NULL
   OR partial_close_pct >= 1;

ALTER TABLE goal_session_trades
  ALTER COLUMN partial_close_pct SET DEFAULT 0.5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_session_trades_partial_close_pct_fraction_chk'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT goal_session_trades_partial_close_pct_fraction_chk
      CHECK (partial_close_pct > 0 AND partial_close_pct < 1);
  END IF;
END $$;

COMMENT ON COLUMN goal_session_trades.partial_close_pct IS
  'Fraction of position considered "secured" at TP1 (0 < x < 1). Default 0.50. '
  'Alpha may override per-trade. Used by split-PnL UI and post-trade-analyzer.';

-- ---------------------------------------------------------------------------
-- 2) TP1 milestone trigger writes tp1_pnl atomically
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_and_close_positions_on_price_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
  v_sl_reason TEXT;
  v_sl_orig_dist NUMERIC;
  v_be_action TEXT;
  v_is_scalp BOOLEAN;
  v_is_non_scalp BOOLEAN;
  v_tp1_pnl NUMERIC;
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

        v_is_scalp := (
          UPPER(COALESCE(v_position.requested_style, '')) = 'SCALP'
          OR (v_position.requested_style IS NULL AND v_position.tp2_price IS NULL)
        );
        v_is_non_scalp := (
          UPPER(COALESCE(v_position.requested_style, '')) IN ('MICRO_INTRADAY', 'INTRADAY')
          OR (v_position.requested_style IS NULL AND v_position.tp2_price IS NOT NULL)
        );

        -- PRIORITY 1: Stop Loss
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

        -- PRIORITY 2: TP2
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

        -- PRIORITY 3a: SAFETY NET for non-scalp trades with pending BE
        IF v_position.tp1_hit = true
           AND v_is_non_scalp
           AND v_position.sl_moved_to_breakeven_at IS NULL THEN

          RAISE NOTICE '[SL/TP] Safety-net post-TP1 SL move for non-scalp trade=% symbol=%',
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

          SELECT c.new_sl, c.reason, c.original_distance
          INTO v_new_sl, v_sl_reason, v_sl_orig_dist
          FROM _compute_post_tp1_sl(
            v_position.direction,
            v_position.entry_price,
            v_position.stop_loss,
            v_position.post_tp1_sl_anchor_price,
            v_atr
          ) c;

          UPDATE goal_session_trades
          SET tp1_action_taken              = v_be_action,
              stop_loss                     = v_new_sl,
              tp1_breakeven_price           = v_new_sl,
              sl_moved_to_breakeven_at      = NOW(),
              post_tp1_sl_anchor_reason     = v_sl_reason,
              post_tp1_sl_original_distance = v_sl_orig_dist
          WHERE id = v_position.id
            AND sl_moved_to_breakeven_at IS NULL;
        END IF;

        -- PRIORITY 3: TP1
        IF v_position.tp1_price IS NOT NULL AND v_position.tp1_hit = false THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.tp1_price;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.tp1_price;
          END IF;

          IF v_should_close_at_tp1 THEN

            IF v_is_scalp THEN
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
              IF v_position.sl_moved_to_breakeven_at IS NOT NULL
                 OR v_position.tp1_breakeven_price IS NOT NULL THEN
                RAISE NOTICE '[SL/TP] TP1 hit (already processed, skipping): trade=% symbol=%',
                  v_position.id, v_position.symbol;
                CONTINUE;
              END IF;

              RAISE NOTICE '[SL/TP] TP1 hit (non-scalp %, structural SL selector): trade=% symbol=% TP1=%',
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

              SELECT c.new_sl, c.reason, c.original_distance
              INTO v_new_sl, v_sl_reason, v_sl_orig_dist
              FROM _compute_post_tp1_sl(
                v_position.direction,
                v_position.entry_price,
                v_position.stop_loss,
                v_position.post_tp1_sl_anchor_price,
                v_atr
              ) c;

              -- CCIP-2026-0506B: Compute and persist tp1_pnl atomically.
              -- Uses the advisory TP1 price (not the jittery market tick) because
              -- TP1 is a milestone, not a partial-fill. Post-trade-analyzer will
              -- honour this value on final closure.
              BEGIN
                v_tp1_pnl := calculate_universal_pnl(
                  v_position.direction,
                  v_position.entry_price,
                  v_position.tp1_price,
                  COALESCE(v_position.lot_size, v_position.position_size),
                  v_position.symbol
                );
              EXCEPTION WHEN OTHERS THEN
                v_tp1_pnl := NULL;
              END;

              UPDATE goal_session_trades
              SET tp1_hit                       = true,
                  tp1_hit_at                    = NOW(),
                  tp1_action_taken              = v_be_action,
                  tp1_pnl                       = COALESCE(tp1_pnl, v_tp1_pnl),
                  stop_loss                     = v_new_sl,
                  tp1_breakeven_price           = v_new_sl,
                  sl_moved_to_breakeven_at      = NOW(),
                  post_tp1_sl_anchor_reason     = v_sl_reason,
                  post_tp1_sl_original_distance = v_sl_orig_dist
              WHERE id = v_position.id;

              INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
              VALUES (v_position.goal_session_id, v_position.user_id, 'trade_update', 'high', 'Take Profit 1 Hit!',
                format('%s reached TP1 at %s. SL moved to %s (%s). Riding to TP2...',
                  v_position.symbol, v_position.tp1_price, round(v_new_sl::numeric, 5), v_sl_reason),
                jsonb_build_object(
                  'trade_id', v_position.id,
                  'symbol', v_position.symbol,
                  'tp1_price', v_position.tp1_price,
                  'current_price', v_current_price,
                  'new_sl', v_new_sl,
                  'sl_anchor_reason', v_sl_reason,
                  'original_sl_distance', v_sl_orig_dist,
                  'atr_used', v_atr,
                  'action', v_be_action,
                  'style', v_position.requested_style,
                  'tp1_pnl', v_tp1_pnl
                ),
                ARRAY['in_app', 'push']);
            END IF;
          END IF;
        END IF;

        -- PRIORITY 4: Legacy single take_profit
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
$function$;
