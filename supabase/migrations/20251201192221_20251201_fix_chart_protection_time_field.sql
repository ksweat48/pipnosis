/*
  # Fix Chart Protection Time Field Reference

  1. Problem
    - Chart protection triggers reference NEW.time which doesn't exist
    - Should use NEW.open_time instead
    - Causing "record 'new' has no field 'time'" error

  2. Changes
    - Drop and recreate validate_candle_structure_and_range function
    - Fix all references from NEW.time to NEW.open_time
    - Fix all references from 'time' column to 'open_time'

  3. Security
    - No changes to RLS policies
    - Function security remains the same
*/

-- Drop the broken function
DROP FUNCTION IF EXISTS validate_candle_structure_and_range() CASCADE;

-- Recreate with correct field references
CREATE OR REPLACE FUNCTION validate_candle_structure_and_range()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_valid_range BOOLEAN;
BEGIN
  -- Validate basic candle structure (high >= low, open/close between high/low)
  IF NEW.high < NEW.low OR 
     NEW.open < NEW.low OR NEW.open > NEW.high OR
     NEW.close < NEW.low OR NEW.close > NEW.high THEN
    
    -- Log the error
    INSERT INTO chart_contamination_log (
      symbol,
      candle_time,
      contamination_type,
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
    -- Log the contamination
    INSERT INTO chart_contamination_log (
      symbol,
      candle_time,
      contamination_type,
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
$$;

-- Recreate triggers
DROP TRIGGER IF EXISTS validate_candle_before_insert ON forex_candles;
DROP TRIGGER IF EXISTS validate_candle_before_update ON forex_candles;

CREATE TRIGGER validate_candle_before_insert
  BEFORE INSERT ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION validate_candle_structure_and_range();

CREATE TRIGGER validate_candle_before_update
  BEFORE UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION validate_candle_structure_and_range();

-- Add comment
COMMENT ON FUNCTION validate_candle_structure_and_range() IS 'Validates candle structure and price ranges before insert/update. Fixed to use open_time instead of time field.';
