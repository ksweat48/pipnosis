/*
  # Fix SL/TP Trigger: Stop Session When Last Trade Closes

  ## Problem
  The `check_and_close_positions_on_price_update` database trigger closes trades
  when SL/TP levels are hit, but does NOT check if the closed trade was the last
  open trade in the session. This creates "ghost sessions" -- sessions stuck in
  active/scanning status with zero open trades.

  ## Root Cause
  The trigger delegates trade closure to `close_goal_session_trade()` RPC but
  never evaluates session state afterward. Other code paths (browser coordinator,
  autonomous-position-monitor, live engine) all have "last trade -> stop session"
  logic, but the database trigger -- which is the fastest closure path for SL/TP --
  was missing it entirely.

  ## Changes
  1. After each trade closure in the SL/TP trigger, check remaining open trades
     for the same session
  2. If zero remaining open trades, stop the session:
     - Set status to 'stopped', completed_at to now()
     - Cancel all active entry intents for the session
  3. Log all session stops to ccip_change_tracking for governance audit

  ## Governance Alignment
  - CCIP: Single-Scan-Single-Trade policy (2026-02-18)
  - SSOT: Database trigger is authoritative for SL/TP closures
  - No auto-scanning after trade closure

  ## Safety
  - No destructive operations
  - Uses IF EXISTS guards
  - Error handling prevents blocking price inserts
*/

CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_sl_distance NUMERIC;
  v_tp_distance NUMERIC;
  v_slippage NUMERIC;
  v_remaining_open_trades INT;
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

        -- PRIORITY 1: Check Stop Loss
        IF v_position.stop_loss IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_sl := v_current_price <= v_position.stop_loss;
            v_sl_distance := v_position.stop_loss - v_current_price;
          ELSE
            v_should_close_at_sl := v_current_price >= v_position.stop_loss;
            v_sl_distance := v_current_price - v_position.stop_loss;
          END IF;

          IF v_should_close_at_sl THEN
            v_close_reason := 'stop_loss';
            v_close_price := v_current_price;
            v_slippage := ABS(v_close_price - v_position.stop_loss);

            RAISE NOTICE '[SL/TP TRIGGER] STOP LOSS: trade_id=% symbol=% SL_level=% actual_close=% slippage=%',
              v_position.id, v_position.symbol, v_position.stop_loss, v_close_price, v_slippage;

            INSERT INTO ssot_violations (
              violation_type, entity_type, entity_id,
              expected_authority, actual_authority, severity, details
            ) VALUES (
              'trigger_based_closure', 'goal_session_trade', v_position.id,
              'alpha_coordinator', 'database_trigger', 'info',
              jsonb_build_object(
                'trigger_name', 'check_and_close_positions_on_price_update',
                'close_reason', v_close_reason,
                'sl_level', v_position.stop_loss,
                'market_price', v_close_price,
                'slippage', v_slippage,
                'symbol', v_position.symbol,
                'direction', v_position.direction
              )
            );

            PERFORM close_goal_session_trade(
              v_position.id, v_close_price, v_close_reason, v_position.goal_session_id
            );

            v_closed_session_id := v_position.goal_session_id;

            INSERT INTO goal_notifications (
              goal_session_id, user_id, type, priority, title, message, metadata, channels
            ) VALUES (
              v_position.goal_session_id, v_position.user_id,
              'trade_closed', 'urgent', 'Stop Loss Hit',
              format('Stop Loss triggered for %s at market price %s (SL level: %s)',
                v_position.symbol, v_close_price, v_position.stop_loss),
              jsonb_build_object(
                'trade_id', v_position.id, 'symbol', v_position.symbol,
                'close_price', v_close_price, 'sl_level', v_position.stop_loss,
                'slippage', v_slippage, 'closed_by', 'database_trigger_sl',
                'trigger_time', now()
              ),
              ARRAY['in_app', 'push']
            );

            -- CHECK: Stop session if this was the last open trade
            IF v_closed_session_id IS NOT NULL THEN
              SELECT COUNT(*) INTO v_remaining_open_trades
              FROM goal_session_trades
              WHERE goal_session_id = v_closed_session_id
                AND status = 'open';

              IF v_remaining_open_trades = 0 THEN
                UPDATE entry_intents
                SET status = 'canceled', canceled_at = now(), conditions_changed_at = now()
                WHERE session_id = v_closed_session_id
                  AND status NOT IN ('canceled', 'expired_no_entry');

                UPDATE goal_sessions
                SET status = 'stopped', completed_at = now(), updated_at = now(), closing_state = 'idle'
                WHERE id = v_closed_session_id
                  AND status NOT IN ('stopped', 'user_stopped', 'goal_achieved', 'timeout');

                INSERT INTO ccip_change_tracking (
                  user_id, operation_type, table_name, record_id, change_details, governance_log_id
                ) VALUES (
                  v_position.user_id,
                  'SESSION_STOPPED_BY_TRIGGER_LAST_TRADE',
                  'goal_sessions',
                  v_closed_session_id,
                  jsonb_build_object(
                    'close_reason', v_close_reason,
                    'last_trade_id', v_position.id,
                    'symbol', v_position.symbol,
                    'trigger', 'check_and_close_positions_on_price_update'
                  ),
                  gen_random_uuid()
                );

                RAISE NOTICE '[SL/TP TRIGGER] SESSION STOPPED: session=% (last trade % closed by %)',
                  v_closed_session_id, v_position.id, v_close_reason;
              END IF;
            END IF;

            CONTINUE;
          END IF;
        END IF;

        -- PRIORITY 2: Check Dual TP System (TP2 then TP1)
        IF v_position.tp2_price IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp2 := v_current_price >= v_position.tp2_price;
            v_tp_distance := v_current_price - v_position.tp2_price;
          ELSE
            v_should_close_at_tp2 := v_current_price <= v_position.tp2_price;
            v_tp_distance := v_position.tp2_price - v_current_price;
          END IF;

          IF v_should_close_at_tp2 THEN
            v_close_reason := 'take_profit_2';
            v_close_price := v_current_price;
            v_slippage := ABS(v_close_price - v_position.tp2_price);

            RAISE NOTICE '[SL/TP TRIGGER] TP2 HIT: trade_id=% symbol=% TP2_level=% actual_close=% bonus=%',
              v_position.id, v_position.symbol, v_position.tp2_price, v_close_price, v_slippage;

            UPDATE goal_session_trades
            SET tp2_hit = true, tp2_hit_at = NOW()
            WHERE id = v_position.id;

            INSERT INTO ssot_violations (
              violation_type, entity_type, entity_id,
              expected_authority, actual_authority, severity, details
            ) VALUES (
              'trigger_based_closure', 'goal_session_trade', v_position.id,
              'alpha_coordinator', 'database_trigger', 'info',
              jsonb_build_object(
                'trigger_name', 'check_and_close_positions_on_price_update',
                'close_reason', v_close_reason,
                'tp2_level', v_position.tp2_price,
                'market_price', v_close_price,
                'bonus_pips', v_slippage,
                'symbol', v_position.symbol
              )
            );

            PERFORM close_goal_session_trade(
              v_position.id, v_close_price, v_close_reason, v_position.goal_session_id
            );

            v_closed_session_id := v_position.goal_session_id;

            INSERT INTO goal_notifications (
              goal_session_id, user_id, type, priority, title, message, metadata, channels
            ) VALUES (
              v_position.goal_session_id, v_position.user_id,
              'trade_closed', 'high', 'Take Profit 2 Hit!',
              format('TP2 achieved for %s at %s (TP2 level: %s)',
                v_position.symbol, v_close_price, v_position.tp2_price),
              jsonb_build_object(
                'trade_id', v_position.id, 'symbol', v_position.symbol,
                'close_price', v_close_price, 'tp2_level', v_position.tp2_price,
                'bonus_pips', v_slippage, 'closed_by', 'database_trigger_tp2',
                'trigger_time', now()
              ),
              ARRAY['in_app', 'push']
            );

            -- CHECK: Stop session if this was the last open trade
            IF v_closed_session_id IS NOT NULL THEN
              SELECT COUNT(*) INTO v_remaining_open_trades
              FROM goal_session_trades
              WHERE goal_session_id = v_closed_session_id
                AND status = 'open';

              IF v_remaining_open_trades = 0 THEN
                UPDATE entry_intents
                SET status = 'canceled', canceled_at = now(), conditions_changed_at = now()
                WHERE session_id = v_closed_session_id
                  AND status NOT IN ('canceled', 'expired_no_entry');

                UPDATE goal_sessions
                SET status = 'stopped', completed_at = now(), updated_at = now(), closing_state = 'idle'
                WHERE id = v_closed_session_id
                  AND status NOT IN ('stopped', 'user_stopped', 'goal_achieved', 'timeout');

                INSERT INTO ccip_change_tracking (
                  user_id, operation_type, table_name, record_id, change_details, governance_log_id
                ) VALUES (
                  v_position.user_id,
                  'SESSION_STOPPED_BY_TRIGGER_LAST_TRADE',
                  'goal_sessions',
                  v_closed_session_id,
                  jsonb_build_object(
                    'close_reason', v_close_reason,
                    'last_trade_id', v_position.id,
                    'symbol', v_position.symbol,
                    'trigger', 'check_and_close_positions_on_price_update'
                  ),
                  gen_random_uuid()
                );

                RAISE NOTICE '[SL/TP TRIGGER] SESSION STOPPED: session=% (last trade % closed by %)',
                  v_closed_session_id, v_position.id, v_close_reason;
              END IF;
            END IF;

            CONTINUE;
          END IF;
        END IF;

        -- Check TP1 milestone (mark flag, don't close)
        IF v_position.tp1_price IS NOT NULL AND v_position.tp1_hit = false THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.tp1_price;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.tp1_price;
          END IF;

          IF v_should_close_at_tp1 THEN
            RAISE NOTICE '[SL/TP TRIGGER] TP1 HIT: trade_id=% symbol=% TP1=% current=% (marking flag, continuing to TP2)',
              v_position.id, v_position.symbol, v_position.tp1_price, v_current_price;

            UPDATE goal_session_trades
            SET tp1_hit = true, tp1_hit_at = NOW(), tp1_action_taken = 'continued'
            WHERE id = v_position.id;

            INSERT INTO goal_notifications (
              goal_session_id, user_id, type, priority, title, message, metadata, channels
            ) VALUES (
              v_position.goal_session_id, v_position.user_id,
              'trade_update', 'high', 'Take Profit 1 Hit!',
              format('%s reached TP1 at %s. Continuing to TP2...', v_position.symbol, v_position.tp1_price),
              jsonb_build_object(
                'trade_id', v_position.id, 'symbol', v_position.symbol,
                'tp1_price', v_position.tp1_price, 'current_price', v_current_price,
                'tp1_hit', true, 'action', 'continued_to_tp2'
              ),
              ARRAY['in_app', 'push']
            );
          END IF;
        END IF;

        -- FALLBACK: Check legacy single take_profit column
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
            v_close_price := v_current_price;
            v_slippage := ABS(v_close_price - v_position.take_profit);

            RAISE NOTICE '[SL/TP TRIGGER] TP (legacy): trade_id=% symbol=% TP_level=% actual_close=%',
              v_position.id, v_position.symbol, v_position.take_profit, v_close_price;

            INSERT INTO ssot_violations (
              violation_type, entity_type, entity_id,
              expected_authority, actual_authority, severity, details
            ) VALUES (
              'trigger_based_closure', 'goal_session_trade', v_position.id,
              'alpha_coordinator', 'database_trigger', 'info',
              jsonb_build_object(
                'trigger_name', 'check_and_close_positions_on_price_update',
                'close_reason', v_close_reason,
                'tp_level', v_position.take_profit,
                'market_price', v_close_price,
                'legacy_mode', true
              )
            );

            PERFORM close_goal_session_trade(
              v_position.id, v_close_price, v_close_reason, v_position.goal_session_id
            );

            v_closed_session_id := v_position.goal_session_id;

            INSERT INTO goal_notifications (
              goal_session_id, user_id, type, priority, title, message, metadata, channels
            ) VALUES (
              v_position.goal_session_id, v_position.user_id,
              'trade_closed', 'high', 'Take Profit Hit!',
              format('Take profit reached for %s at %s (TP level: %s)',
                v_position.symbol, v_close_price, v_position.take_profit),
              jsonb_build_object(
                'trade_id', v_position.id, 'symbol', v_position.symbol,
                'close_price', v_close_price, 'tp_level', v_position.take_profit,
                'closed_by', 'database_trigger_tp', 'trigger_time', now()
              ),
              ARRAY['in_app', 'push']
            );

            -- CHECK: Stop session if this was the last open trade
            IF v_closed_session_id IS NOT NULL THEN
              SELECT COUNT(*) INTO v_remaining_open_trades
              FROM goal_session_trades
              WHERE goal_session_id = v_closed_session_id
                AND status = 'open';

              IF v_remaining_open_trades = 0 THEN
                UPDATE entry_intents
                SET status = 'canceled', canceled_at = now(), conditions_changed_at = now()
                WHERE session_id = v_closed_session_id
                  AND status NOT IN ('canceled', 'expired_no_entry');

                UPDATE goal_sessions
                SET status = 'stopped', completed_at = now(), updated_at = now(), closing_state = 'idle'
                WHERE id = v_closed_session_id
                  AND status NOT IN ('stopped', 'user_stopped', 'goal_achieved', 'timeout');

                INSERT INTO ccip_change_tracking (
                  user_id, operation_type, table_name, record_id, change_details, governance_log_id
                ) VALUES (
                  v_position.user_id,
                  'SESSION_STOPPED_BY_TRIGGER_LAST_TRADE',
                  'goal_sessions',
                  v_closed_session_id,
                  jsonb_build_object(
                    'close_reason', v_close_reason,
                    'last_trade_id', v_position.id,
                    'symbol', v_position.symbol,
                    'trigger', 'check_and_close_positions_on_price_update'
                  ),
                  gen_random_uuid()
                );

                RAISE NOTICE '[SL/TP TRIGGER] SESSION STOPPED: session=% (last trade % closed by %)',
                  v_closed_session_id, v_position.id, v_close_reason;
              END IF;
            END IF;
          END IF;
        END IF;

      EXCEPTION
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
          RAISE WARNING '[SL/TP TRIGGER] Error processing position %: %', v_position.id, v_error_message;

          INSERT INTO goal_notifications (
            goal_session_id, user_id, type, priority, title, message, metadata, channels
          ) VALUES (
            v_position.goal_session_id, v_position.user_id,
            'system_alert', 'high', 'SL/TP Check Error',
            format('Error checking SL/TP for %s: %s', v_position.symbol, v_error_message),
            jsonb_build_object('trade_id', v_position.id, 'error', v_error_message),
            ARRAY['in_app']
          );
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

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
'SSOT-compliant SL/TP trigger. Closes trades at actual market price when SL/TP hit.
GOVERNANCE (2026-02-18): Stops session and cancels intents when last trade closes.
Logs all closures and session stops to ccip_change_tracking for audit.';