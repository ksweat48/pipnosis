/*
  # Add Realtime Stop Loss / Take Profit Trigger

  This migration adds a database trigger that automatically checks if any open positions
  should be closed whenever a new price is inserted into realtime_prices.

  ## Purpose
  - Provides SECOND layer of SL/TP protection (client monitor + database trigger)
  - Runs automatically on every price insert (8 times per minute per symbol)
  - Zero latency - triggers immediately when price data arrives
  - Independent of client browsers and external cron services

  ## How It Works
  1. Trigger fires when price inserted into realtime_prices
  2. Finds all open positions for that symbol
  3. Checks if price breaches SL or TP
  4. Closes position automatically if breach detected

  ## Security
  - Uses service role to close positions
  - Logs all trigger closures for audit
  - Creates notifications for user
*/

-- Create function to check and close positions on price update
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
BEGIN
  -- Only process INSERT operations
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
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

      -- Log trigger closure
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
        '⚠️ Stop Loss Hit (Database Trigger)',
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

      -- Log trigger closure
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
        '✅ Take Profit Hit (Database Trigger)',
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
  END LOOP;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_check_positions_on_price_update ON realtime_prices;

-- Create trigger on realtime_prices table
CREATE TRIGGER trigger_check_positions_on_price_update
AFTER INSERT ON realtime_prices
FOR EACH ROW
EXECUTE FUNCTION check_and_close_positions_on_price_update();

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'Automatically checks and closes open positions when SL or TP is hit. Runs on every price insert for zero-latency protection.';

COMMENT ON TRIGGER trigger_check_positions_on_price_update ON realtime_prices IS
  'Second layer of stop loss protection. Triggers automatically when price data arrives (8x per minute), independent of client browsers. Server-side protection that works 24/7.';
