/*
  # Add Lot Size Validation Constraints

  ## Problem
  Lot size corruption was causing unrealistic PnL displays (e.g., $6.9M on ETHUSD)

  ## Changes
  1. Add check constraint to ensure lot_size is within reasonable range (0.001 to 1000)
  2. Add check constraint to ensure position_size is within reasonable range
  3. Add validation trigger to prevent insertion of corrupt lot sizes
  4. Audit existing trades and fix any corrupt lot_size values

  ## Valid Ranges
  - Minimum: 0.001 lots (micro lots)
  - Maximum: 1000 lots (institutional size, extremely rare for demo accounts)
  - Typical range: 0.01 to 100 lots
*/

-- Add check constraints if they don't exist
DO $$
BEGIN
  -- Add lot_size range constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_lot_size_range' 
    AND conrelid = 'goal_session_trades'::regclass
  ) THEN
    ALTER TABLE goal_session_trades
    ADD CONSTRAINT valid_lot_size_range
    CHECK (lot_size >= 0.001 AND lot_size <= 1000);
    
    RAISE NOTICE '✓ Added lot_size range constraint (0.001 to 1000)';
  END IF;

  -- Add position_size range constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_position_size_range' 
    AND conrelid = 'goal_session_trades'::regclass
  ) THEN
    ALTER TABLE goal_session_trades
    ADD CONSTRAINT valid_position_size_range
    CHECK (position_size >= 0.001 AND position_size <= 1000);
    
    RAISE NOTICE '✓ Added position_size range constraint (0.001 to 1000)';
  END IF;
END $$;

-- Create validation trigger function
CREATE OR REPLACE FUNCTION validate_lot_size_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Validate lot_size
  IF NEW.lot_size IS NOT NULL THEN
    IF NEW.lot_size < 0.001 THEN
      RAISE EXCEPTION 'lot_size too small: % (minimum: 0.001)', NEW.lot_size;
    END IF;
    
    IF NEW.lot_size > 1000 THEN
      RAISE EXCEPTION 'lot_size too large: % (maximum: 1000)', NEW.lot_size;
    END IF;
    
    -- Check for unrealistic values that might indicate corruption
    IF NEW.lot_size > 100 THEN
      RAISE WARNING 'Unusually large lot_size detected: % lots. This may be an error.', NEW.lot_size;
    END IF;
  END IF;

  -- Validate position_size
  IF NEW.position_size IS NOT NULL THEN
    IF NEW.position_size < 0.001 THEN
      RAISE EXCEPTION 'position_size too small: % (minimum: 0.001)', NEW.position_size;
    END IF;
    
    IF NEW.position_size > 1000 THEN
      RAISE EXCEPTION 'position_size too large: % (maximum: 1000)', NEW.position_size;
    END IF;
  END IF;

  -- Ensure lot_size and position_size are in sync
  IF NEW.lot_size IS NOT NULL AND NEW.position_size IS NOT NULL THEN
    IF ABS(NEW.lot_size - NEW.position_size) > 0.001 THEN
      RAISE WARNING 'lot_size (%) and position_size (%) mismatch. Using lot_size value.', 
        NEW.lot_size, NEW.position_size;
      -- Sync position_size to lot_size
      NEW.position_size := NEW.lot_size;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS validate_lot_size_trigger ON goal_session_trades;

-- Create trigger on INSERT and UPDATE
CREATE TRIGGER validate_lot_size_trigger
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_lot_size_before_insert();

GRANT EXECUTE ON FUNCTION validate_lot_size_before_insert() TO authenticated, service_role;

-- Audit and fix existing corrupt lot sizes
DO $$
DECLARE
  v_rec record;
  v_count integer := 0;
  v_fixed_count integer := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '  AUDITING LOT SIZES IN EXISTING TRADES';
  RAISE NOTICE '══════════════════════════════════════════════════════════';

  -- Check for trades with unrealistic lot sizes
  FOR v_rec IN
    SELECT id, symbol, direction, lot_size, position_size, entry_price, current_price, status
    FROM goal_session_trades
    WHERE lot_size > 100 OR lot_size < 0.001
       OR position_size > 100 OR position_size < 0.001
       OR ABS(lot_size - position_size) > 0.01
    ORDER BY created_at DESC
  LOOP
    v_count := v_count + 1;
    
    RAISE NOTICE '[%] Trade % (%): lot_size=%, position_size=%, status=%',
      v_count, v_rec.id, v_rec.symbol, v_rec.lot_size, v_rec.position_size, v_rec.status;

    -- For corrupt values, reset to safe default based on typical demo account usage
    IF v_rec.lot_size > 100 OR v_rec.lot_size < 0.001 THEN
      UPDATE goal_session_trades
      SET lot_size = 0.1,  -- Safe default
          position_size = 0.1,
          updated_at = now()
      WHERE id = v_rec.id;
      
      v_fixed_count := v_fixed_count + 1;
      RAISE NOTICE '  → FIXED: Reset to 0.1 lots (safe default)';
    END IF;
  END LOOP;

  RAISE NOTICE '══════════════════════════════════════════════════════════';
  IF v_count = 0 THEN
    RAISE NOTICE '✓ NO CORRUPT LOT SIZES FOUND';
  ELSE
    RAISE NOTICE '✓ AUDIT COMPLETE: % issues found, % fixed', v_count, v_fixed_count;
  END IF;
  RAISE NOTICE '══════════════════════════════════════════════════════════';
END $$;
