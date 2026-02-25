/*
  # CCIP Fix: TP1-only trade closure when tp2_price is NULL + session status 'stopped' bug

  ## Root Cause 1 — TP1-only trade never closes
  When Alpha sets tp1_price but NOT tp2_price, the trigger:
    1. TP2 check: tp2_price IS NULL → skipped
    2. TP1 check: hit → marks flag, continues (designed to ride to TP2)
    3. Legacy fallback: only runs when tp1_price IS NULL AND tp2_price IS NULL → SKIPPED

  Result: Trade with tp1_hit=true, tp2_price=NULL is stuck open forever.

  ## Root Cause 2 — Session never transitions to terminal state after trade closes
  The _stop_session_if_last_trade helper (and the inline code in the old trigger)
  set status = 'stopped', which is NOT in the goal_sessions_status_check constraint.
  Valid terminal statuses: completed, user_stopped, system_stopped, goal_achieved, cancelled.
  Fix: Use 'system_stopped' for trigger-initiated session closures.

  ## CCIP Compliance
  - Single authority: trigger remains the only DB-level price monitor
  - 'stopped' removed from all session update statements, replaced with 'system_stopped'
  - Governance: logged to ccip_change_tracking
  - Post-deploy: existing stuck trade force-closed in DO block below
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: stop session when last open trade closes
-- SSOT for all trigger-based session termination
-- Uses 'system_stopped' — the correct constraint-compliant status
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _stop_session_if_last_trade(
  p_session_id UUID,
  p_user_id UUID,
  p_trade_id UUID,
  p_close_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining INT;
BEGIN
  IF p_session_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_remaining
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
  AND status = 'open';

  IF v_remaining = 0 THEN
    UPDATE entry_intents
    SET status = 'canceled', canceled_at = now(), conditions_changed_at = now()
    WHERE session_id = p_session_id
    AND status NOT IN ('canceled', 'expired_no_entry');

    -- SSOT: 'system_stopped' is the valid constraint-compliant status for trigger closures
    UPDATE goal_sessions
    SET status = 'system_stopped', completed_at = now(), updated_at = now(), closing_state = 'idle'
    WHERE id = p_session_id
    AND status NOT IN ('completed', 'user_stopped', 'system_stopped', 'goal_achieved', 'cancelled');

    INSERT INTO ccip_change_tracking (
      user_id, operation_type, table_name, record_id, change_details, governance_log_id
    ) VALUES (
      p_user_id,
      'SESSION_STOPPED_BY_TRIGGER_LAST_TRADE',
      'goal_sessions',
      p_session_id,
      jsonb_build_object(
        'close_reason', p_close_reason,
        'last_trade_id', p_trade_id,
        'trigger', 'check_and_close_positions_on_price_update',
        'new_status', 'system_stopped'
      ),
      gen_random_uuid()
    );

    RAISE NOTICE '[SL/TP TRIGGER] SESSION system_stopped: session=% (last trade % closed by %)',
      p_session_id, p_trade_id, p_close_reason;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Main trigger: check and close positions on price update
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_closed_session_id UUID;
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
        v_closed_session_id := NULL;

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
              -- TP2 exists — mark TP1 as advisory milestone only, keep position open
              RAISE NOTICE '[SL/TP] TP1 hit (advisory, riding to TP2): trade=% symbol=% TP1=%',
                v_position.id, v_position.symbol, v_position.tp1_price;

              UPDATE goal_session_trades
              SET tp1_hit = true, tp1_hit_at = NOW(), tp1_action_taken = 'continued'
              WHERE id = v_position.id;

              INSERT INTO goal_notifications (goal_session_id, user_id, type, priority, title, message, metadata, channels)
              VALUES (v_position.goal_session_id, v_position.user_id, 'trade_update', 'high', 'Take Profit 1 Hit!',
                format('%s reached TP1 at %s. Continuing to TP2...', v_position.symbol, v_position.tp1_price),
                jsonb_build_object('trade_id', v_position.id, 'symbol', v_position.symbol, 'tp1_price', v_position.tp1_price, 'current_price', v_current_price, 'action', 'continued_to_tp2'),
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
-- EMERGENCY: Force-close the stuck NAS100 trade for ksweat48
-- tp1_hit=true, tp2_price=NULL — was stuck open because trigger used wrong path
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_trade RECORD;
  v_close_price NUMERIC;
  v_result JSONB;
BEGIN
  SELECT t.*, rp.bid
  INTO v_trade
  FROM goal_session_trades t
  LEFT JOIN realtime_prices rp ON rp.symbol = t.symbol
  WHERE t.id = '21e719d4-7b6c-48ca-ab29-30a45e0ce0ba'
  AND t.status = 'open';

  IF NOT FOUND THEN
    RAISE NOTICE '[EMERGENCY] Trade 21e719d4 already closed — no action needed.';
    RETURN;
  END IF;

  -- BID for long exit (SSOT)
  v_close_price := COALESCE(v_trade.bid, v_trade.tp1_price, v_trade.take_profit);

  RAISE NOTICE '[EMERGENCY] Closing stuck NAS100 BUY id=% at % (tp1=%, tp2=NULL)',
    v_trade.id, v_close_price, v_trade.tp1_price;

  v_result := close_goal_session_trade(
    v_trade.id, v_close_price, 'take_profit_1', v_trade.goal_session_id, TRUE
  );

  PERFORM _stop_session_if_last_trade(
    v_trade.goal_session_id, v_trade.user_id, v_trade.id, 'take_profit_1'
  );

  RAISE NOTICE '[EMERGENCY] Done: %', v_result;
END $$;
