/*
  # Fix Lot Size / Position Size Trigger Conflict

  ## Problem Analysis
  The `trigger_sync_lot_size` trigger incorrectly overwrites `lot_size` with `position_size`.
  This is wrong because:
  - `lot_size` = Standard trading lots (e.g., 0.14 lots)
  - `position_size` = Forex units (lot_size * 100,000, e.g., 14,000 units)
  
  These are different units and should NOT be synced to equal values.

  ## Root Cause
  Trigger execution order (alphabetical):
  1. `trigger_sync_lot_size` - CORRUPTS lot_size by setting it to position_size (0.14 -> 14000)
  2. `trigger_sync_position_size` - Tries to sync but damage is done
  3. `validate_lot_size_trigger` - Rejects because 14000 > 1000

  ## Fix Applied
  1. Drop `trigger_sync_lot_size` and its function `sync_lot_size_with_position_size`
  2. Update validation to only validate `lot_size` (not `position_size` which is in units)
  3. Keep `trigger_sync_position_size` as it has correct conditional logic

  ## SSOT Compliance
  - lot_size is the SSOT for trading lot quantity
  - position_size is derived as lot_size * 100000 (forex units)
  - These fields serve different purposes and should not be forced equal

  ## Impact
  - Fixes: "lot_size too large: 13850 (maximum: 1000)" errors
  - No data loss - only removing bad trigger logic
  - Backward compatible - existing trades unaffected
*/

-- Step 1: Drop the problematic trigger
DROP TRIGGER IF EXISTS trigger_sync_lot_size ON goal_session_trades;

-- Step 2: Drop the problematic function
DROP FUNCTION IF EXISTS sync_lot_size_with_position_size();

-- Step 3: Update validation function to only validate lot_size (not position_size)
-- Position_size is in forex units (lot_size * 100000) so it's naturally large
CREATE OR REPLACE FUNCTION validate_lot_size_before_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate lot_size only (this is in standard lots: 0.01 - 100)
  IF NEW.lot_size IS NOT NULL THEN
    IF NEW.lot_size < 0.001 THEN
      RAISE EXCEPTION 'lot_size too small: % (minimum: 0.001)', NEW.lot_size;
    END IF;

    IF NEW.lot_size > 1000 THEN
      RAISE EXCEPTION 'lot_size too large: % (maximum: 1000)', NEW.lot_size;
    END IF;

    -- Warning for unusually large positions (but not blocking)
    IF NEW.lot_size > 100 THEN
      RAISE WARNING 'Unusually large lot_size detected: % lots. This may be an error.', NEW.lot_size;
    END IF;
  END IF;

  -- NOTE: position_size is NOT validated against lot limits because:
  -- position_size = lot_size * 100000 (forex units)
  -- A lot_size of 0.14 = position_size of 14000, which is expected
  
  -- Only validate position_size is positive if provided
  IF NEW.position_size IS NOT NULL AND NEW.position_size < 0 THEN
    RAISE EXCEPTION 'position_size cannot be negative: %', NEW.position_size;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Ensure sync_position_size_from_lot_size function is correct
-- This function should derive position_size FROM lot_size, not the other way around
CREATE OR REPLACE FUNCTION sync_position_size_from_lot_size()
RETURNS TRIGGER AS $$
BEGIN
  -- Derive position_size from lot_size (forex units = lots * 100000)
  IF NEW.lot_size IS NOT NULL THEN
    -- If lot_size is provided, calculate position_size as forex units
    -- Only sync if position_size wasn't explicitly set or seems wrong
    IF NEW.position_size IS NULL OR NEW.position_size < 1 THEN
      NEW.position_size := ROUND(NEW.lot_size * 100000);
    END IF;
  ELSIF NEW.position_size IS NOT NULL AND NEW.lot_size IS NULL THEN
    -- If only position_size provided, derive lot_size
    NEW.lot_size := NEW.position_size / 100000.0;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
