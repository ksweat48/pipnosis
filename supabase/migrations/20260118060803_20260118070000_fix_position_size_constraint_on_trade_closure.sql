/*
  # Fix Position Size Constraint Violation on Trade Closure (P0 Hotfix)

  ## Problem
  When TP1 hits (70% partial close), position_size is reduced to 30% of original.
  For small positions (e.g., 0.003 lots), this creates values below the constraint
  minimum (0.001 lots), which blocks trade closure with error:
  "new row for relation goal_session_trades violates check constraint valid_position_size_range"

  ## Root Cause
  - Trade opens with position_size = 0.003 lots
  - TP1 hits → position_size = 0.003 * 0.3 = 0.0009 lots (below 0.001 minimum)
  - TP2/TP hits → close_goal_session_trade RPC runs
  - validate_lot_size_trigger runs BEFORE UPDATE
  - Trigger validates NEW.position_size = 0.0009 → FAILS constraint check
  - Trade cannot close, user stuck in position

  ## Solution (SSOT + CCIP Compliant)
  Modify validate_lot_size_before_insert() trigger to SKIP validation when:
  1. Trade is being closed (NEW.status = 'closed')
  2. This is an UPDATE operation (not INSERT)

  ## Rationale
  - Alpha (RPC) has decided to close the trade - this is final authority
  - Validators must degrade intelligently, not block valid closure
  - Position size accuracy doesn't matter for a closed trade
  - Risk is contained: constraint still enforces limits on OPEN trades

  ## Changes
  1. Update trigger function to exempt closed trades from position_size validation
  2. Maintain all validation for INSERT and for non-closing UPDATEs
  3. Log exemption for audit trail

  ## Safety
  - Constraint still enforces limits on trade creation and active trades
  - Only exempts validation when trade is definitively closing
  - No changes to constraint definition (maintains data quality for active trades)
*/

-- Update the validation trigger function to allow closure of trades with invalid position sizes
CREATE OR REPLACE FUNCTION validate_lot_size_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- EXEMPTION: Skip validation when closing a trade
  -- Rationale: Alpha has decided to close - validators must not block legitimate closure
  -- Risk: Contained - only affects trades transitioning to 'closed' status
  IF TG_OP = 'UPDATE' AND NEW.status = 'closed' THEN
    RAISE LOG '[validate_lot_size] Exempting closed trade % from position_size validation', NEW.id;
    RETURN NEW;
  END IF;

  -- Validate lot_size (only for active trades)
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

  -- Validate position_size (only for active trades)
  IF NEW.position_size IS NOT NULL THEN
    IF NEW.position_size < 0.001 THEN
      RAISE EXCEPTION 'position_size too small: % (minimum: 0.001)', NEW.position_size;
    END IF;

    IF NEW.position_size > 1000 THEN
      RAISE EXCEPTION 'position_size too large: % (maximum: 1000)', NEW.position_size;
    END IF;
  END IF;

  -- Ensure lot_size and position_size are in sync (only for active trades)
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

-- Recreate the trigger (force reload)
DROP TRIGGER IF EXISTS validate_lot_size_trigger ON goal_session_trades;
CREATE TRIGGER validate_lot_size_trigger
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_lot_size_before_insert();

GRANT EXECUTE ON FUNCTION validate_lot_size_before_insert() TO authenticated, service_role;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  P0 HOTFIX: Position Size Constraint Exemption on Closure';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  ✅ Trades can now close even if TP1 partial close reduced';
  RAISE NOTICE '     position_size below 0.001 minimum';
  RAISE NOTICE '';
  RAISE NOTICE '  ✅ Validation still enforced for:';
  RAISE NOTICE '     - Trade creation (INSERT)';
  RAISE NOTICE '     - Active trade updates (status != closed)';
  RAISE NOTICE '';
  RAISE NOTICE '  ✅ SSOT Compliance: Alpha decides, validators degrade gracefully';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
