/*
  # Fix Stuck Position Detection - Use Fresh Prices

  ## Problem
  The detect_stuck_positions() function uses the current_price column from goal_session_trades,
  which is only updated when the client-side position monitor runs. If the browser is closed,
  this price becomes stale and stuck positions cannot be detected.

  ## Solution
  Modify detect_stuck_positions() to fetch FRESH prices from realtime_prices table
  instead of relying on the potentially stale current_price column.

  ## Changes
  1. Join with realtime_prices to get the most recent price for each symbol
  2. Compare fresh prices against SL/TP
  3. Add fallback to forex_candles if realtime_prices is stale
*/

CREATE OR REPLACE FUNCTION detect_stuck_positions()
RETURNS TABLE (
  trade_id uuid,
  symbol text,
  status text,
  stuck_reason text,
  seconds_stuck integer,
  current_price numeric,
  stop_loss numeric,
  take_profit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position RECORD;
  v_fresh_price NUMERIC;
  v_price_age_seconds INTEGER;
  v_should_close_sl BOOLEAN;
  v_should_close_tp BOOLEAN;
BEGIN
  -- Process each open position
  FOR v_position IN
    SELECT 
      gst.id,
      gst.symbol,
      gst.status,
      gst.direction,
      gst.entry_price,
      gst.stop_loss,
      gst.take_profit,
      gst.current_price AS cached_price,
      gst.updated_at,
      gst.last_tp_sl_check_at,
      gst.close_attempts_count
    FROM goal_session_trades gst
    WHERE gst.status IN ('open', 'pending', 'soft_closing')
  LOOP
    -- Get fresh price from realtime_prices (most recent for this symbol)
    SELECT 
      CASE 
        WHEN v_position.direction = 'buy' THEN rp.bid::numeric
        ELSE rp.ask::numeric
      END,
      EXTRACT(EPOCH FROM (NOW() - rp.created_at))::integer
    INTO v_fresh_price, v_price_age_seconds
    FROM realtime_prices rp
    WHERE rp.symbol = v_position.symbol
    ORDER BY rp.created_at DESC
    LIMIT 1;

    -- If no realtime price or too old (> 5 min), try forex_candles
    IF v_fresh_price IS NULL OR v_price_age_seconds > 300 THEN
      SELECT fc.close::numeric
      INTO v_fresh_price
      FROM forex_candles fc
      WHERE fc.symbol = v_position.symbol
        AND fc.timeframe = '5m'
      ORDER BY fc.timestamp DESC
      LIMIT 1;
      
      v_price_age_seconds := 300; -- Assume candle data is moderately fresh
    END IF;

    -- If still no price, use cached price (last resort)
    IF v_fresh_price IS NULL THEN
      v_fresh_price := v_position.cached_price;
      v_price_age_seconds := EXTRACT(EPOCH FROM (NOW() - v_position.updated_at))::integer;
    END IF;

    -- Skip if no price data available at all
    IF v_fresh_price IS NULL THEN
      CONTINUE;
    END IF;

    -- Check if SL/TP should have triggered
    IF v_position.direction = 'buy' THEN
      v_should_close_sl := v_fresh_price <= v_position.stop_loss;
      v_should_close_tp := v_fresh_price >= v_position.take_profit;
    ELSE
      v_should_close_sl := v_fresh_price >= v_position.stop_loss;
      v_should_close_tp := v_fresh_price <= v_position.take_profit;
    END IF;

    -- Case 1: Open position hit SL/TP but didn't close (use fresh price!)
    IF v_position.status = 'open' 
      AND v_position.stop_loss IS NOT NULL 
      AND v_position.take_profit IS NOT NULL
      AND (v_should_close_sl OR v_should_close_tp) THEN
      
      trade_id := v_position.id;
      symbol := v_position.symbol;
      status := v_position.status;
      stuck_reason := CASE 
        WHEN v_should_close_sl THEN 'Open position hit SL but did not close (fresh price check)'
        ELSE 'Open position hit TP but did not close (fresh price check)'
      END;
      seconds_stuck := COALESCE(v_price_age_seconds, 0);
      current_price := v_fresh_price;
      stop_loss := v_position.stop_loss;
      take_profit := v_position.take_profit;
      RETURN NEXT;
      
    -- Case 2: Stuck in soft_closing for too long (> 5 min)
    ELSIF v_position.status = 'soft_closing' 
      AND EXTRACT(EPOCH FROM (NOW() - v_position.updated_at)) > 300 THEN
      
      trade_id := v_position.id;
      symbol := v_position.symbol;
      status := v_position.status;
      stuck_reason := 'Stuck in soft_closing for over 5 minutes';
      seconds_stuck := EXTRACT(EPOCH FROM (NOW() - v_position.updated_at))::integer;
      current_price := v_fresh_price;
      stop_loss := v_position.stop_loss;
      take_profit := v_position.take_profit;
      RETURN NEXT;
      
    -- Case 3: Multiple failed close attempts
    ELSIF v_position.status = 'open' 
      AND v_position.close_attempts_count > 3 THEN
      
      trade_id := v_position.id;
      symbol := v_position.symbol;
      status := v_position.status;
      stuck_reason := format('Has %s failed close attempts', v_position.close_attempts_count);
      seconds_stuck := EXTRACT(EPOCH FROM (NOW() - v_position.updated_at))::integer;
      current_price := v_fresh_price;
      stop_loss := v_position.stop_loss;
      take_profit := v_position.take_profit;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION detect_stuck_positions() IS
  'FIXED: Now fetches FRESH prices from realtime_prices table instead of using potentially stale current_price. Falls back to forex_candles then cached price. This enables stuck position detection even when browser is closed.';
