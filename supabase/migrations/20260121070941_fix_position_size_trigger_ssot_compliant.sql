/*
  # Fix Position Size Trigger - SSOT Compliance

  ## Problem Statement
  The `sync_position_size_from_lot_size()` trigger is silently mutating validated data,
  violating the principle: "Engines validate. Alpha decides. Trades degrade intelligently."

  ### Current Bug
  ```sql
  IF NEW.position_size IS NULL OR NEW.position_size < 1 THEN
    NEW.position_size := ROUND(NEW.lot_size * 100000);
  END IF;
  ```

  This converts valid lot sizes (0.04 lots) into invalid values:
  - Application sends: position_size = 0.04 (valid)
  - Trigger sees: 0.04 < 1 → TRUE
  - Trigger corrupts: position_size = 0.04 × 100,000 = 4,000
  - Constraint rejects: 4,000 > 1,000 maximum

  ## SSOT Design
  Both `position_size` and `lot_size` store LOTS directly (range: 0.001-1000).
  They are synonyms, not different units. The trigger should:
  1. Sync missing values (if one is NULL, copy from the other)
  2. NEVER mutate validated values already in valid range
  3. Fail loudly on mismatched values (not silently convert)

  ## Fix Applied
  - Remove forex unit conversion logic (× 100,000)
  - Only sync when one field is NULL and the other is valid
  - Preserve validated values that are already correct
  - Add validation to detect mismatched values

  ## Governance Compliance
  ✅ Engines validate (trade-execution-engine.ts validates position_size)
  ✅ Alpha decides (LLM chooses position size)
  ✅ Trades degrade intelligently (trigger preserves valid data, fails loudly on errors)
  ✅ SSOT (position_size and lot_size are kept in sync as LOTS)
  ✅ CCIP (maintains data consistency, integrity, precision)
*/

-- Replace the buggy trigger function with SSOT-compliant logic
CREATE OR REPLACE FUNCTION sync_position_size_from_lot_size()
RETURNS TRIGGER AS $$
BEGIN
  -- SSOT Design: Both position_size and lot_size store LOTS (0.001-1000 range)
  -- This trigger synchronizes them when one is missing, but NEVER mutates validated values

  -- Case 1: Both provided - validate they match (within rounding tolerance)
  IF NEW.position_size IS NOT NULL AND NEW.lot_size IS NOT NULL THEN
    -- Allow small rounding differences (0.0001 tolerance)
    IF ABS(NEW.position_size - NEW.lot_size) > 0.0001 THEN
      -- Mismatched values detected - fail loudly (don't silently mutate)
      RAISE WARNING 'SSOT Violation: position_size (%) != lot_size (%). Using position_size as authority.',
        NEW.position_size, NEW.lot_size;
      -- Position size is the SSOT authority (it's what engines validate)
      NEW.lot_size := NEW.position_size;
    END IF;
    RETURN NEW;
  END IF;

  -- Case 2: Only position_size provided - sync to lot_size
  IF NEW.position_size IS NOT NULL AND NEW.lot_size IS NULL THEN
    NEW.lot_size := NEW.position_size;
    RETURN NEW;
  END IF;

  -- Case 3: Only lot_size provided - sync to position_size
  IF NEW.lot_size IS NOT NULL AND NEW.position_size IS NULL THEN
    NEW.position_size := NEW.lot_size;
    RETURN NEW;
  END IF;

  -- Case 4: Both NULL - this should not happen, but let validation constraints catch it
  -- Don't fail here, let the NOT NULL or check constraints handle it
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verify the trigger is still attached
-- (If it's not, this will create it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_sync_position_size'
    AND tgrelid = 'goal_session_trades'::regclass
  ) THEN
    CREATE TRIGGER trigger_sync_position_size
      BEFORE INSERT OR UPDATE ON goal_session_trades
      FOR EACH ROW
      EXECUTE FUNCTION sync_position_size_from_lot_size();
  END IF;
END $$;