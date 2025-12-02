/*
  # Fix validate_candle_before_write Trigger Function
  
  ## Problem
  The validate_candle_before_write() trigger function references NEW.time which doesn't exist.
  The forex_candles table uses open_time and close_time columns, not time.
  
  ## Changes
  - Replace all references to NEW.time with NEW.open_time in validate_candle_before_write()
  - This fixes the error: "record 'new' has no field 'time'"
  
  ## Impact
  - Allows candles to be inserted/updated successfully
  - Enables server-side scheduled functions to persist data
*/

CREATE OR REPLACE FUNCTION public.validate_candle_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_valid_structure boolean;
  v_valid_range boolean;
BEGIN
  -- Validate candle structure
  v_valid_structure := validate_candle_structure(
    NEW.open,
    NEW.high,
    NEW.low,
    NEW.close
  );
  
  IF NOT v_valid_structure THEN
    -- Log validation failure
    INSERT INTO candle_validation_failures (
      symbol,
      candle_time,
      validation_type,
      error_message,
      candle_data,
      severity
    ) VALUES (
      NEW.symbol,
      NEW.open_time,  -- FIXED: Was NEW.time
      'structure',
      'Invalid candle structure: high=' || NEW.high || ', low=' || NEW.low || ', open=' || NEW.open || ', close=' || NEW.close,
      jsonb_build_object(
        'open', NEW.open,
        'high', NEW.high,
        'low', NEW.low,
        'close', NEW.close
      ),
      'high'
    );
    
    RAISE EXCEPTION 'Invalid candle structure for % at %: high must be >= low, and open/close must be between high and low',
      NEW.symbol, NEW.open_time;  -- FIXED: Was NEW.time
  END IF;
  
  -- Validate price range
  v_valid_range := validate_candle_price_range(
    NEW.symbol,
    NEW.open,
    NEW.high,
    NEW.low,
    NEW.close
  );
  
  IF NOT v_valid_range THEN
    -- Log validation failure
    INSERT INTO candle_validation_failures (
      symbol,
      candle_time,
      validation_type,
      error_message,
      candle_data,
      severity
    ) VALUES (
      NEW.symbol,
      NEW.open_time,  -- FIXED: Was NEW.time
      'price_range',
      'Price outside valid range for ' || NEW.symbol,
      jsonb_build_object(
        'open', NEW.open,
        'high', NEW.high,
        'low', NEW.low,
        'close', NEW.close
      ),
      'critical'
    );
    
    RAISE EXCEPTION 'Price outside valid range for % at %',
      NEW.symbol, NEW.open_time;  -- FIXED: Was NEW.time
  END IF;
  
  RETURN NEW;
END;
$function$;
