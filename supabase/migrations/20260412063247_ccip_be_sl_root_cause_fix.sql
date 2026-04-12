/*
  # Break-Even SL Root Cause Fix — CCIP-2026-BE001

  ## Summary
  This migration implements the planned root-cause fix for break-even SL
  protection after TP1 is hit. Previously, 96 trades hit TP1 and continued
  with ZERO SL movement — the original stop loss remained active throughout.

  ## Changes

  ### 1. Constraint Consolidation
  Drops three conflicting `tp1_action_taken` constraints (valid_tp1_action,
  valid_tp1_action_taken, and the duplicate from an earlier migration) and
  replaces them with a single authoritative constraint that includes all
  valid values — including the new `sl_moved_to_breakeven` and
  `sl_moved_to_breakeven_fallback` values the trigger and TypeScript will write.

  ### 2. Trigger Upgrade — check_and_close_positions_on_price_update
  The TP1 advisory branch (ELSE block where tp2_price IS NOT NULL) now:
  - Computes ATR from the last 14 H1 candles for the symbol (high-low method)
  - Falls back to conservative symbol-class defaults if no candle data exists
  - Computes newSL = entry_price + (atr * 0.10) for buys, opposite for sells
  - Updates stop_loss, tp1_breakeven_price, sl_moved_to_breakeven_at, and
    tp1_action_taken in the same UPDATE statement as tp1_hit = true
  - Sets tp1_action_taken = 'sl_moved_to_breakeven' (live ATR) or
    'sl_moved_to_breakeven_fallback' (fallback ATR) — never 'continued'

  ### 3. mark_tp1_milestone RPC Upgrade
  The Netlify autonomous-position-monitor calls this RPC. It previously only
  set tp1_hit=true and tp1_hit_at. It now also moves the SL to break-even
  using the same ATR calculation, making it consistent with the trigger.

  ### Security
  No new tables — no RLS changes required.
  The trigger runs as SECURITY DEFINER and has full access to goal_session_trades.
  The RPC runs as SECURITY DEFINER (already established).

  ### Important Notes
  1. 'continued' is now RESERVED for legacy closed trades only — new trades
     will never see 'continued' after this migration.
  2. The TypeScript layer (autoMoveSLAfterTP1) becomes a backup failsafe only.
  3. The trigger is the primary authority as it fires on every price tick.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop all conflicting tp1_action_taken constraints
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE goal_session_trades
  DROP CONSTRAINT IF EXISTS valid_tp1_action,
  DROP CONSTRAINT IF EXISTS valid_tp1_action_taken;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Add the single authoritative tp1_action_taken constraint
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE goal_session_trades
  ADD CONSTRAINT tp1_action_taken_ssot CHECK (
    tp1_action_taken IS NULL
    OR tp1_action_taken = ANY (ARRAY[
      'continued',                       -- legacy value (existing closed trades)
      'advisory_only',                   -- legacy value (existing closed trades)
      'closed_early',                    -- legacy value (existing closed trades)
      'closed_no_tp2',                   -- trigger: TP1 sole target, no TP2
      'sl_moved_to_breakeven',           -- trigger/RPC: SL moved using live ATR
      'sl_moved_to_breakeven_fallback'   -- trigger/RPC: SL moved using fallback ATR
    ])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Upgrade the SL/TP trigger function
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- BE SL variables
  v_atr NUMERIC;
  v_new_sl NUMERIC;
  v_be_action TEXT;
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

            RAISE NOTICE '[SL/TP] TP2 hit: trade=% symbol=% TP2=% price=%',
              v_position.id, v_position.symbol, v_position.tp2_price, v_close_price;

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

        -- ── PRIORITY 3: TP1 ──────────────────────────────────────────────────
        IF v_position.tp1_price IS NOT NULL AND v_position.tp1_hit = false THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.tp1_price;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.tp1_price;
          END IF;

          IF v_should_close_at_tp1 THEN

            IF v_position.tp2_price IS NULL THEN
              -- TP1 is the SOLE target — close the trade
              v_close_reason := 'take_profit_1';
              v_close_price  := v_current_price;

              RAISE NOTICE '[SL/TP] TP1 hit (sole target, no TP2): trade=% symbol=% TP1=% price=%',
                v_position.id, v_position.symbol, v_position.tp1_price, v_close_price;

              UPDATE goal_session_trades
              SET tp1_hit = true, tp1_hit_at = NOW(), tp1_action_taken = 'closed_no_tp2'
              WHERE id = v_position.id;

              INSERT INTO ssot_violations (violation_type, entity_type, entity_id, expected_authority, actual_authority, severity, details)
              VALUES ('trigger_based_closure', 'goal_session_trade', v_position.id, 'alpha_coordinator', 'database_trigger', 'info',
                jsonb_build_object('close_reason', v_close_reason, 'tp1_level', v_position.tp1_price, 'market_price', v_close_price, 'tp2_present', false, 'symbol', v_position.symbol));

              PERFORM close_goal_session_trade(v_position.id, v_close_price, v_close_reason, v_position.goal_session_id);

              INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
              VALUES (v_position.goal_session_id, v_position.user_id, 'trade_closed', 'high', 'Take Profit Hit!',
                format('%s closed at TP: %s', v_position.symbol, v_close_price),
                jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'close_price', v_close_price, 'tp1_level', v_position.tp1_price, 'trigger_time', now()),
                ARRAY['in_app', 'push']);

              PERFORM _stop_session_if_last_trade(v_position.goal_session_id, v_position.user_id, v_position.id, v_close_reason);
              CONTINUE;

            ELSE
              -- ─────────────────────────────────────────────────────────────
              -- TP2 EXISTS — advisory milestone: keep position open, MOVE SL
              -- ─────────────────────────────────────────────────────────────
              -- Only move SL if it hasn't been moved yet (idempotent guard)
              IF v_position.tp1_breakeven_price IS NOT NULL THEN
                -- SL was already moved by a previous tick or the TS layer — skip
                RAISE NOTICE '[SL/TP] TP1 hit (already processed, skipping BE): trade=% symbol=%',
                  v_position.id, v_position.symbol;
                CONTINUE;
              END IF;

              RAISE NOTICE '[SL/TP] TP1 hit (advisory, moving SL to BE): trade=% symbol=% TP1=%',
                v_position.id, v_position.symbol, v_position.tp1_price;

              -- ── ATR calculation from recent H1 candles (high - low method) ──
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

              -- ── Fallback ATR by symbol class ──────────────────────────────
              IF v_atr IS NULL OR v_atr <= 0 THEN
                IF v_position.symbol IN ('XAUUSD') THEN
                  v_atr := 0.80;            -- ~8 pips XAUUSD (0.1 pip = 0.01)
                ELSIF v_position.symbol IN ('US30', 'NAS100', 'SPX500') THEN
                  v_atr := 50.0;            -- ~50 points for indices
                ELSIF v_position.symbol ILIKE '%JPY%' THEN
                  v_atr := 0.08;            -- ~8 pips JPY pairs
                ELSIF v_position.symbol IN ('BTCUSD', 'ETHUSD') THEN
                  v_atr := 200.0;           -- crypto fallback
                ELSE
                  v_atr := 0.0005;          -- 5 pips standard forex
                END IF;
                v_be_action := 'sl_moved_to_breakeven_fallback';
              ELSE
                v_be_action := 'sl_moved_to_breakeven';
              END IF;

              -- ── Compute break-even SL: entry ± (ATR * 0.10) ──────────────
              IF v_position.direction = 'buy' THEN
                v_new_sl := v_position.entry_price + (v_atr * 0.10);
              ELSE
                v_new_sl := v_position.entry_price - (v_atr * 0.10);
              END IF;

              -- ── Write tp1_hit + BE SL in one atomic UPDATE ────────────────
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
                jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'tp1_price', v_position.tp1_price, 'current_price', v_current_price, 'new_sl', v_new_sl, 'atr_used', v_atr, 'action', v_be_action),
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

            RAISE NOTICE '[SL/TP] TP (legacy): trade=% symbol=% TP=% price=%',
              v_position.id, v_position.symbol, v_position.take_profit, v_close_price;

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
-- STEP 4: Upgrade mark_tp1_milestone RPC to also move SL to break-even
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
BEGIN
  -- Get trade using explicit alias
  SELECT t.* INTO v_trade
  FROM goal_session_trades AS t
  WHERE t.id = mark_tp1_milestone.trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade must be open to mark TP1', 'current_status', v_trade.status);
  END IF;

  -- Idempotent guard: if TP1 already processed, return early
  IF v_trade.tp1_hit = true THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'trade_id', mark_tp1_milestone.trade_id);
  END IF;

  -- If BE SL was already moved, just mark tp1_hit without re-moving
  IF v_trade.tp1_breakeven_price IS NOT NULL THEN
    UPDATE goal_session_trades AS t
    SET tp1_hit = true, tp1_hit_at = NOW(), updated_at = NOW()
    WHERE t.id = mark_tp1_milestone.trade_id;

    RETURN jsonb_build_object('success', true, 'trade_id', mark_tp1_milestone.trade_id, 'tp1_hit_at', NOW(), 'sl_already_moved', true);
  END IF;

  -- ── ATR from recent H1 candles ──────────────────────────────────────────
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

  -- ── Fallback ATR ─────────────────────────────────────────────────────────
  IF v_atr IS NULL OR v_atr <= 0 THEN
    IF v_trade.symbol IN ('XAUUSD') THEN
      v_atr := 0.80;
    ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500') THEN
      v_atr := 50.0;
    ELSIF v_trade.symbol ILIKE '%JPY%' THEN
      v_atr := 0.08;
    ELSIF v_trade.symbol IN ('BTCUSD', 'ETHUSD') THEN
      v_atr := 200.0;
    ELSE
      v_atr := 0.0005;
    END IF;
    v_be_action := 'sl_moved_to_breakeven_fallback';
  ELSE
    v_be_action := 'sl_moved_to_breakeven';
  END IF;

  -- ── Break-even SL ────────────────────────────────────────────────────────
  IF v_trade.direction = 'buy' THEN
    v_new_sl := v_trade.entry_price + (v_atr * 0.10);
  ELSE
    v_new_sl := v_trade.entry_price - (v_atr * 0.10);
  END IF;

  -- ── Atomic write: TP1 milestone + BE SL ──────────────────────────────────
  UPDATE goal_session_trades AS t
  SET
    tp1_hit               = true,
    tp1_hit_at            = NOW(),
    tp1_action_taken      = v_be_action,
    stop_loss             = v_new_sl,
    tp1_breakeven_price   = v_new_sl,
    sl_moved_to_breakeven_at = NOW(),
    updated_at            = NOW()
  WHERE t.id = mark_tp1_milestone.trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', mark_tp1_milestone.trade_id,
    'tp1_hit_at', NOW(),
    'new_sl', v_new_sl,
    'atr_used', v_atr,
    'action', v_be_action
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute to authenticated and service_role (matching existing pattern)
GRANT EXECUTE ON FUNCTION mark_tp1_milestone(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_tp1_milestone(UUID) TO service_role;
