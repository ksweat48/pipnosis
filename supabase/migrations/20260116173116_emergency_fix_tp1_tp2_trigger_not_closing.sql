/*
  # EMERGENCY P0 FIX - TP1/TP2 Trades Not Closing
  
  ## Critical Issue
  Trades are hitting TP1 and TP2 (flags are being set) but the database trigger
  is NOT closing them. Trades remain open indefinitely after hitting take profits.
  
  ## Root Cause
  The `check_and_close_positions_on_price_update()` trigger only checks the old
  `take_profit` column, but the system now uses:
  - `tp1_hit` flag + `take_profit_1` for first target
  - `tp2_hit` flag + `take_profit_2` for second target
  
  ## Fix
  Update trigger to:
  1. Check tp2_hit flag - if true AND trade still open, close it immediately
  2. Check if current price reaches take_profit_2 → close
  3. Check if current price reaches take_profit_1 → set tp1_hit flag
  4. Fallback to old take_profit column for backwards compatibility
  
  ## Affected Users
  All users with open trades that hit TP1/TP2 in last 24-48 hours
*/

-- Drop existing trigger first
DROP TRIGGER IF EXISTS trigger_check_positions_on_price_update ON realtime_prices;

-- Recreate the function with TP1/TP2 support
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

        -- EMERGENCY FIX: Check if TP2 was already hit but trade still open
        IF v_position.tp2_hit = true AND v_position.status = 'open' THEN
          RAISE NOTICE 'EMERGENCY: Trade % has TP2 hit but still open! Force closing now.', v_position.id;
          
          v_close_price := COALESCE(v_position.take_profit_2, v_position.take_profit, v_current_price);
          v_close_reason := 'take_profit_2';
          
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
            'critical',
            '🚨 Emergency Close - TP2 Already Hit',
            format('Emergency trigger closed %s. TP2 was hit earlier but trade remained open.', v_position.symbol),
            jsonb_build_object(
              'trade_id', v_position.id,
              'symbol', v_position.symbol,
              'close_price', v_close_price,
              'closed_by', 'emergency_tp2_fix'
            ),
            ARRAY['in_app', 'push']
          );
          
          CONTINUE; -- Move to next trade
        END IF;

        -- Check Stop Loss
        IF v_position.stop_loss IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_sl := v_current_price <= v_position.stop_loss;
          ELSE
            v_should_close_at_sl := v_current_price >= v_position.stop_loss;
          END IF;

          IF v_should_close_at_sl THEN
            v_close_reason := 'stop_loss';
            v_close_price := v_position.stop_loss;

            RAISE NOTICE 'Closing position % at SL: % (current: %)',
              v_position.id, v_close_price, v_current_price;

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
              'urgent',
              'Stop Loss Hit',
              format('Closed %s at stop loss. Price: %s', v_position.symbol, v_close_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'close_price', v_close_price,
                'current_price', v_current_price,
                'closed_by', 'database_trigger'
              ),
              ARRAY['in_app', 'push']
            );

            CONTINUE; -- Move to next trade
          END IF;
        END IF;

        -- Check Take Profit 2 (final exit)
        IF v_position.take_profit_2 IS NOT NULL THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp2 := v_current_price >= v_position.take_profit_2;
          ELSE
            v_should_close_at_tp2 := v_current_price <= v_position.take_profit_2;
          END IF;

          IF v_should_close_at_tp2 THEN
            v_close_reason := 'take_profit_2';
            v_close_price := v_position.take_profit_2;

            RAISE NOTICE 'Closing position % at TP2: % (current: %)',
              v_position.id, v_close_price, v_current_price;

            -- Update tp2_hit flag before closing
            UPDATE goal_session_trades
            SET tp2_hit = true,
                tp2_hit_at = NOW()
            WHERE id = v_position.id;

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
              '🎯 Take Profit 2 Hit!',
              format('Closed %s at TP2. Price: %s', v_position.symbol, v_close_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'close_price', v_close_price,
                'current_price', v_current_price,
                'closed_by', 'database_trigger_tp2'
              ),
              ARRAY['in_app', 'push']
            );

            CONTINUE; -- Move to next trade
          END IF;
        END IF;

        -- Check Take Profit 1 (partial exit point - just mark it, don't close)
        IF v_position.take_profit_1 IS NOT NULL AND v_position.tp1_hit = false THEN
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.take_profit_1;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.take_profit_1;
          END IF;

          IF v_should_close_at_tp1 THEN
            RAISE NOTICE 'Position % hit TP1: % (current: %)',
              v_position.id, v_position.take_profit_1, v_current_price;

            -- Just mark TP1 as hit, don't close the position
            UPDATE goal_session_trades
            SET tp1_hit = true,
                tp1_hit_at = NOW()
            WHERE id = v_position.id;

            -- Notify about TP1 hit
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
              format('%s reached TP1. Holding for TP2...', v_position.symbol),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'tp1_price', v_position.take_profit_1,
                'current_price', v_current_price,
                'tp1_hit', true
              ),
              ARRAY['in_app', 'push']
            );
          END IF;
        END IF;

        -- FALLBACK: Check old single take_profit column for backwards compatibility
        IF v_position.take_profit IS NOT NULL 
           AND v_position.take_profit_1 IS NULL 
           AND v_position.take_profit_2 IS NULL THEN
          
          IF v_position.direction = 'buy' THEN
            v_should_close_at_tp1 := v_current_price >= v_position.take_profit;
          ELSE
            v_should_close_at_tp1 := v_current_price <= v_position.take_profit;
          END IF;

          IF v_should_close_at_tp1 THEN
            v_close_reason := 'take_profit';
            v_close_price := v_position.take_profit;

            RAISE NOTICE 'Closing position % at TP (legacy): % (current: %)',
              v_position.id, v_close_price, v_current_price;

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
              'Take Profit Hit',
              format('Closed %s at take profit. Price: %s', v_position.symbol, v_close_price),
              jsonb_build_object(
                'trade_id', v_position.id,
                'symbol', v_position.symbol,
                'close_price', v_close_price,
                'current_price', v_current_price,
                'closed_by', 'database_trigger'
              ),
              ARRAY['in_app']
            );
          END IF;
        END IF;

      EXCEPTION
        WHEN OTHERS THEN
          -- Log error but don't block price insert
          GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
          RAISE WARNING 'Failed to close position % in trigger: %', v_position.id, v_error_message;
          -- Continue to next position
      END;
    END LOOP;

  EXCEPTION
    WHEN OTHERS THEN
      -- Log any outer errors but allow price insert to succeed
      GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
      RAISE WARNING 'Error in price update trigger for symbol %: %', NEW.symbol, v_error_message;
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

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_trades_open_tp_monitoring 
  ON goal_session_trades(symbol, status, tp2_hit, tp1_hit) 
  WHERE status = 'open';
