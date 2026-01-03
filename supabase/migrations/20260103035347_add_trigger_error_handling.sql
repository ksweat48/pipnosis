/*
  # Add Error Handling to Price Update Trigger

  ## Problem
  The trigger function `check_and_close_positions_on_price_update()` was causing
  500 errors when inserting prices because if the trigger fails, the entire INSERT fails.

  ## Solution
  Wrap trigger logic in exception handling so that:
  1. Price inserts ALWAYS succeed (critical for live trading)
  2. Trigger errors are logged but don't block price data
  3. Failed closures are tracked for manual review

  ## Changes
  - Add BEGIN/EXCEPTION block to catch and log errors
  - Log failures to system logs for debugging
  - Allow price insert to succeed even if position closure fails
*/

-- Recreate function with error handling
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

        -- Close position if SL or TP triggered
        IF v_should_close_at_sl THEN
          v_close_reason := 'stop_loss';
          v_close_price := v_position.stop_loss;

          RAISE NOTICE 'Database trigger closing position % at SL: % (current: %)',
            v_position.id, v_close_price, v_current_price;

          -- Close the position using the RPC function
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
            'Stop Loss Hit (Database Trigger)',
            format('Database trigger closed %s at stop loss. Price: %s', v_position.symbol, v_close_price),
            jsonb_build_object(
              'trade_id', v_position.id,
              'symbol', v_position.symbol,
              'close_price', v_close_price,
              'current_price', v_current_price,
              'closed_by', 'database_trigger'
            ),
            ARRAY['in_app']
          );

        ELSIF v_should_close_at_tp THEN
          v_close_reason := 'take_profit';
          v_close_price := v_position.take_profit;

          RAISE NOTICE 'Database trigger closing position % at TP: % (current: %)',
            v_position.id, v_close_price, v_current_price;

          -- Close the position
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
            'Take Profit Hit (Database Trigger)',
            format('Database trigger closed %s at take profit. Price: %s', v_position.symbol, v_close_price),
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

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'Automatically checks and closes open positions when SL or TP is hit. Error-tolerant: failures are logged but do not block price inserts.';