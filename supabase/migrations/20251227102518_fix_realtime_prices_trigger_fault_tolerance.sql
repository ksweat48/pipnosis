/*
  # Make Realtime Prices Trigger Fault-Tolerant
  
  ## Problem
  The SL/TP trigger on realtime_prices is throwing constraint errors when trying
  to create notifications. This causes the ENTIRE price insert to fail/rollback,
  resulting in missing tick data and flat-line candles.
  
  ## Solution  
  Wrap notification inserts in exception handlers so price data ALWAYS saves,
  even if the notification fails. Price data is critical - notifications are nice-to-have.
  
  ## Changes
  - Add BEGIN/EXCEPTION blocks around notification inserts
  - Log errors but don't let them bubble up
  - Ensure RETURN NEW always executes
*/

CREATE OR REPLACE FUNCTION check_and_close_positions_on_price_update()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_position RECORD;
  v_current_price NUMERIC;
  v_should_close_at_sl BOOLEAN;
  v_should_close_at_tp BOOLEAN;
  v_close_reason TEXT;
  v_close_price NUMERIC;
  v_last_check_time TIMESTAMPTZ;
  v_seconds_since_last_check NUMERIC;
BEGIN
  -- Only process INSERT operations
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- RATE LIMITING: Check if we processed this symbol recently
  SELECT created_at INTO v_last_check_time
  FROM realtime_prices
  WHERE symbol = NEW.symbol
    AND created_at < NEW.created_at
  ORDER BY created_at DESC
  LIMIT 1;

  -- Calculate time since last check
  IF v_last_check_time IS NOT NULL THEN
    v_seconds_since_last_check := EXTRACT(EPOCH FROM (NEW.created_at - v_last_check_time));
    
    -- Skip if we checked this symbol within last 10 seconds
    IF v_seconds_since_last_check < 10 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Find all open positions for this symbol
  FOR v_position IN
    SELECT *
    FROM goal_session_trades
    WHERE symbol = NEW.symbol
      AND status = 'open'
      AND stop_loss IS NOT NULL
      AND take_profit IS NOT NULL
  LOOP
    BEGIN
      -- Determine current price based on direction
      IF v_position.direction = 'buy' THEN
        v_current_price := NEW.bid::numeric;
      ELSE
        v_current_price := NEW.ask::numeric;
      END IF;

      -- Check if SL or TP should trigger
      IF v_position.direction = 'buy' THEN
        v_should_close_at_sl := v_current_price <= v_position.stop_loss;
        v_should_close_at_tp := v_current_price >= v_position.take_profit;
      ELSE
        v_should_close_at_sl := v_current_price >= v_position.stop_loss;
        v_should_close_at_tp := v_current_price <= v_position.take_profit;
      END IF;

      -- Close position if SL triggered
      IF v_should_close_at_sl THEN
        v_close_reason := 'stop_loss';
        v_close_price := v_position.stop_loss;

        -- Close the position
        PERFORM close_goal_session_trade(
          v_position.id,
          v_close_price,
          v_close_reason,
          v_position.goal_session_id
        );

        -- Try to create notification (but don't fail if it errors)
        BEGIN
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
            'sl_triggered',
            'urgent',
            'Stop Loss Hit',
            format('%s closed at stop loss: %s', v_position.symbol, v_close_price),
            jsonb_build_object(
              'trade_id', v_position.id,
              'symbol', v_position.symbol,
              'close_price', v_close_price,
              'current_price', v_current_price,
              'closed_by', 'database_trigger'
            ),
            ARRAY['in_app']
          );
        EXCEPTION WHEN OTHERS THEN
          -- Log but don't fail - price data is more important
          RAISE WARNING 'Failed to create SL notification for trade %: %', v_position.id, SQLERRM;
        END;

      ELSIF v_should_close_at_tp THEN
        v_close_reason := 'take_profit';
        v_close_price := v_position.take_profit;

        -- Close the position
        PERFORM close_goal_session_trade(
          v_position.id,
          v_close_price,
          v_close_reason,
          v_position.goal_session_id
        );

        -- Try to create notification (but don't fail if it errors)
        BEGIN
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
            'tp_triggered',
            'high',
            'Take Profit Hit',
            format('%s closed at take profit: %s', v_position.symbol, v_close_price),
            jsonb_build_object(
              'trade_id', v_position.id,
              'symbol', v_position.symbol,
              'close_price', v_close_price,
              'current_price', v_current_price,
              'closed_by', 'database_trigger'
            ),
            ARRAY['in_app']
          );
        EXCEPTION WHEN OTHERS THEN
          -- Log but don't fail - price data is more important
          RAISE WARNING 'Failed to create TP notification for trade %: %', v_position.id, SQLERRM;
        END;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- Log but don't fail the entire price insert
      RAISE WARNING 'Error processing position % for price update: %', v_position.id, SQLERRM;
    END;
  END LOOP;

  -- ALWAYS return NEW so price data is saved
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'Fault-tolerant SL/TP checker. Rate-limited to 10s intervals. Catches errors to ensure price data always saves even if notifications fail.';