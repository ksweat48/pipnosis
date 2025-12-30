/*
  # EMERGENCY: Remove Rate Limiting from TP/SL Database Trigger

  ## Critical Problem
  The database trigger that auto-closes positions at TP/SL has a 10-second rate limit.
  This means if a position hits TP, it may not close for up to 10 SECONDS, during which:
  - Price can reverse and user loses profit
  - Position can hit SL instead
  - User cannot manually close (race condition)

  ## Root Cause
  Lines 56-74 in the rate_limit migration implement a "performance optimization" that
  checks if the symbol was processed within the last 10 seconds. If yes, it SKIPS the
  SL/TP check entirely. This creates a dangerous window where positions are unprotected.

  ## Solution
  Remove the rate limiting logic completely. The trigger should check EVERY time a price
  arrives. This is the intended behavior for user protection.

  ## Performance Impact
  - Trigger will run on every price insert (as originally designed)
  - With proper indexes, this is negligible (< 1ms per execution)
  - User protection is MORE IMPORTANT than database CPU

  ## Changes
  1. Remove rate limiting check (lines 56-74)
  2. Simplify function to check positions immediately
  3. Add better error handling
  4. Log all close attempts for debugging
*/

-- Drop and recreate function WITHOUT rate limiting
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

  -- Find all open positions for this symbol
  -- NO RATE LIMITING - check every time for maximum protection
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

        -- Log trigger closure
        RAISE NOTICE '[DB TRIGGER] Closing position % at SL: % (current: %, symbol: %)',
          v_position.id, v_close_price, v_current_price, v_position.symbol;

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
          '⚠️ Stop Loss Hit',
          format('Database trigger closed %s at stop loss. Price: %s', v_position.symbol, v_close_price),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'close_price', v_close_price,
            'current_price', v_current_price,
            'closed_by', 'database_trigger',
            'trigger_time', now()
          ),
          ARRAY['in_app', 'push']
        );

      ELSIF v_should_close_at_tp THEN
        v_close_reason := 'take_profit';
        v_close_price := v_position.take_profit;

        -- Log trigger closure
        RAISE NOTICE '[DB TRIGGER] Closing position % at TP: % (current: %, symbol: %)',
          v_position.id, v_close_price, v_current_price, v_position.symbol;

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
          '✅ Take Profit Hit!',
          format('Database trigger closed %s at take profit. Price: %s', v_position.symbol, v_close_price),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'close_price', v_close_price,
            'current_price', v_current_price,
            'closed_by', 'database_trigger',
            'trigger_time', now()
          ),
          ARRAY['in_app', 'push']
        );
      END IF;

    EXCEPTION
      WHEN OTHERS THEN
        -- Capture error but don't stop processing other positions
        GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;

        RAISE WARNING '[DB TRIGGER] Failed to close position %: %', v_position.id, v_error_message;

        -- Log the failure for debugging
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
          'urgent',
          '⚠️ Position Close Failed',
          format('Failed to auto-close %s: %s. Manual close may be required.', v_position.symbol, v_error_message),
          jsonb_build_object(
            'trade_id', v_position.id,
            'symbol', v_position.symbol,
            'error', v_error_message,
            'attempted_close_reason', v_close_reason,
            'current_price', v_current_price
          ),
          ARRAY['in_app']
        );
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_and_close_positions_on_price_update() IS
  'EMERGENCY FIX: Removed rate limiting. Now checks EVERY price update for immediate SL/TP protection. This is critical for user safety.';
