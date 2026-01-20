/*
  # CRITICAL P0 FIX - SL/TP Not Closing Due to Wrong Column Names (SSOT Violation)

  ## Root Cause
  The database trigger `check_and_close_positions_on_price_update()` checks columns:
  - `take_profit_1` (WRONG - never populated)
  - `take_profit_2` (WRONG - never populated)
  
  But the frontend and monitoring systems use:
  - `tp1_price` (CORRECT - populated by trades)
  - `tp2_price` (CORRECT - populated by trades)

  Result: Trigger runs on every price update but IF conditions are ALWAYS FALSE.
  Trades never close at TP1/TP2.

  ## SSOT Authority Definition
  AUTHORITATIVE COLUMNS for goal_session_trades:
  - stop_loss (numeric)    → Stop loss price
  - tp1_price (numeric)    → Conservative take profit (80%+ probability)
  - tp2_price (numeric)    → Full take profit target
  - tp1_hit (boolean)      → TP1 reached flag
  - tp2_hit (boolean)      → TP2 reached flag  
  - take_profit (numeric)  → Legacy single TP (backward compatibility)

  DEPRECATED COLUMNS (DO NOT USE):
  - take_profit_1 (exists but never populated)
  - take_profit_2 (exists but never populated)

  ## Fix
  Update trigger to check CORRECT columns:
  - tp1_price instead of take_profit_1
  - tp2_price instead of take_profit_2

  ## CCIP Compliance
  ✅ System Map: Verified frontend uses tp1_price/tp2_price
  ✅ Logic Contract: SSOT authority documented above
  ✅ Compatibility Check: Backward compat with single TP maintained
  ✅ Staged Deployment: Trigger recreated, no data loss risk
  ✅ Post-Deploy Verification: Monitor logs for "TP1 HIT" and "TP2 HIT" messages
*/

-- Drop existing broken trigger
DROP TRIGGER IF EXISTS trigger_check_positions_on_price_update ON realtime_prices;

-- Recreate function with CORRECT column names
CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
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
BEGIN
  -- Only process INSERT operations
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Wrap all logic in exception handler to prevent blocking price inserts
  BEGIN
    -- Find all open positions for this symbol
    FOR v_position IN
      SELECT *
      FROM goal_session_trades
      WHERE symbol = NEW.symbol
        AND status = 'open'
    LOOP
      BEGIN
        -- Determine current price based on direction
        IF v_position.direction = 'buy' THEN
          v_current_price := NEW.bid::numeric;
        ELSE
          v_current_price := NEW.ask::numeric;
        END IF;

        -- PRIORITY 1: Check Stop Loss (always full close)
        IF v_position.stop_loss IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_sl := v_current_price <= v_position.stop_loss;
          ELSE
            v_should_close_at_sl := v_current_price >= v_position.stop_loss;
          END IF;

          IF v_should_close_at_sl THEN
            v_close_reason := 'stop_loss';
            v_close_price := v_position.stop_loss;

            RAISE NOTICE '[SL/TP TRIGGER] 🛑 STOP LOSS: trade_id=% symbol=% SL=% current=%',
              v_position.id, v_position.symbol, v_close_price, v_current_price;

            -- Close via RPC
            PERFORM close_goal_session_trade(
              v_position.id,
              v_close_price,
              v_close_reason,
              v_position.goal_session_id
            );

            -- Create notification
            INSERT INTO goal_notifications (
              goal_session_id,
              user_id,
              type,
              priority,
              title,
              message,
              metadata,
              channels
            ) VALUES (
              v_position.goal_session_id,
              v_position.user_id,
              'trade_closed',
              'urgent',
              '🛑 Stop Loss Hit',
              format('Stop Loss triggered for %s at %s', v_position.symbol, v_close_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'close_price', v_close_price,
                'current_price', v_current_price,
                'closed_by', 'database_trigger_sl',
                'trigger_time', now()
              ),
              ARRAY['in_app', 'push']
            );

            CONTINUE; -- Move to next trade
          END IF;
        END IF;

        -- PRIORITY 2: Check Dual TP System (TP2 then TP1)
        -- SSOT FIX: Use tp2_price NOT take_profit_2
        IF v_position.tp2_price IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp2 := v_current_price >= v_position.tp2_price;
          ELSE
            v_should_close_at_tp2 := v_current_price <= v_position.tp2_price;
          END IF;

          IF v_should_close_at_tp2 THEN
            v_close_reason := 'take_profit_2';
            v_close_price := v_position.tp2_price;

            RAISE NOTICE '[SL/TP TRIGGER] 🎯🎯 TP2 HIT: trade_id=% symbol=% TP2=% current=%',
              v_position.id, v_position.symbol, v_close_price, v_current_price;

            -- Mark TP2 as hit before closing
            UPDATE goal_session_trades
            SET tp2_hit = true,
                tp2_hit_at = NOW()
            WHERE id = v_position.id;

            -- Close full position
            PERFORM close_goal_session_trade(
              v_position.id,
              v_close_price,
              v_close_reason,
              v_position.goal_session_id
            );

            -- Create notification
            INSERT INTO goal_notifications (
              goal_session_id,
              user_id,
              type,
              priority,
              title,
              message,
              metadata,
              channels
            ) VALUES (
              v_position.goal_session_id,
              v_position.user_id,
              'trade_closed',
              'high',
              '🎯 Take Profit 2 Hit!',
              format('TP2 achieved for %s at %s - Full target reached!', v_position.symbol, v_close_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'close_price', v_close_price,
                'current_price', v_current_price,
                'closed_by', 'database_trigger_tp2',
                'trigger_time', now()
              ),
              ARRAY['in_app', 'push']
            );

            CONTINUE; -- Move to next trade
          END IF;
        END IF;

        -- Check TP1 milestone (mark flag, don't close)
        -- SSOT FIX: Use tp1_price NOT take_profit_1
        IF v_position.tp1_price IS NOT NULL AND v_position.tp1_hit = false THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.tp1_price;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.tp1_price;
          END IF;

          IF v_should_close_at_tp1 THEN
            RAISE NOTICE '[SL/TP TRIGGER] 🎯 TP1 HIT: trade_id=% symbol=% TP1=% current=% (marking flag, continuing to TP2)',
              v_position.id, v_position.symbol, v_position.tp1_price, v_current_price;

            -- Just mark TP1 as hit, DON'T close position
            UPDATE goal_session_trades
            SET tp1_hit = true,
                tp1_hit_at = NOW(),
                tp1_action_taken = 'continued'
            WHERE id = v_position.id;

            -- Notify about TP1 milestone
            INSERT INTO goal_notifications (
              goal_session_id,
              user_id,
              type,
              priority,
              title,
              message,
              metadata,
              channels
            ) VALUES (
              v_position.goal_session_id,
              v_position.user_id,
              'trade_update',
              'high',
              '✅ Take Profit 1 Hit!',
              format('%s reached TP1 at %s. Continuing to TP2...', v_position.symbol, v_position.tp1_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'tp1_price', v_position.tp1_price,
                'current_price', v_current_price,
                'tp1_hit', true,
                'action', 'continued_to_tp2'
              ),
              ARRAY['in_app', 'push']
            );

            -- Continue monitoring for TP2
          END IF;
        END IF;

        -- FALLBACK: Check legacy single take_profit column (backward compatibility)
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
            v_close_price := v_position.take_profit;

            RAISE NOTICE '[SL/TP TRIGGER] 🎯 TP (legacy): trade_id=% symbol=% TP=% current=%',
              v_position.id, v_position.symbol, v_close_price, v_current_price;

            PERFORM close_goal_session_trade(
              v_position.id,
              v_close_price,
              v_close_reason,
              v_position.goal_session_id
            );

            INSERT INTO goal_notifications (
              goal_session_id,
              user_id,
              type,
              priority,
              title,
              message,
              metadata,
              channels
            ) VALUES (
              v_position.goal_session_id,
              v_position.user_id,
              'trade_closed',
              'high',
              '🎯 Take Profit Hit!',
              format('Take profit reached for %s at %s', v_position.symbol, v_close_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'close_price', v_close_price,
                'current_price', v_current_price,
                'closed_by', 'database_trigger_tp',
                'trigger_time', now()
              ),
              ARRAY['in_app', 'push']
            );
          END IF;
        END IF;

      EXCEPTION
        WHEN OTHERS THEN
          -- Log error but don't block price insert or other position checks
          GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
          RAISE WARNING '[SL/TP TRIGGER] Error processing position %: %', v_position.id, v_error_message;
          
          -- Log error notification for debugging
          INSERT INTO goal_notifications (
            goal_session_id,
            user_id,
            type,
            priority,
            title,
            message,
            metadata,
            channels
          ) VALUES (
            v_position.goal_session_id,
            v_position.user_id,
            'system_alert',
            'high',
            '⚠️ SL/TP Check Error',
            format('Error checking SL/TP for %s: %s', v_position.symbol, v_error_message),
            jsonb_build_object(
              'trade_id', v_position.id,
              'error', v_error_message
            ),
            ARRAY['in_app']
          );
          -- Continue to next position
      END;
    END LOOP;

  EXCEPTION
    WHEN OTHERS THEN
      -- Log any outer errors but allow price insert to succeed
      GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
      RAISE WARNING '[SL/TP TRIGGER] Outer error for symbol %: %', NEW.symbol, v_error_message;
  END;

  -- ALWAYS return NEW to allow price insert to succeed
  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER trigger_check_positions_on_price_update
  AFTER INSERT ON realtime_prices
  FOR EACH ROW
  EXECUTE FUNCTION check_and_close_positions_on_price_update();

-- Add comment documenting SSOT compliance
COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS 
  'SSOT COMPLIANT: Checks tp1_price/tp2_price (NOT take_profit_1/take_profit_2). Auto-closes positions at SL/TP with zero latency. Updated 2026-01-20 to fix column name SSOT violation.';

COMMENT ON TRIGGER trigger_check_positions_on_price_update ON realtime_prices IS
  'Real-time SL/TP protection trigger. Fires on every price insert. Uses CORRECT columns: tp1_price, tp2_price, stop_loss. Fixed 2026-01-20.';

-- Add index for performance (if not exists)
CREATE INDEX IF NOT EXISTS idx_trades_open_sl_tp_monitoring 
  ON goal_session_trades(symbol, status, tp1_hit, tp2_hit, stop_loss, tp1_price, tp2_price) 
  WHERE status = 'open';
