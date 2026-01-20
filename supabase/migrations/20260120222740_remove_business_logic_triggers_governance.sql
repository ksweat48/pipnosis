/*
  # Remove Business Logic Triggers - Governance Architecture

  ## Purpose
  Move business logic from database to TypeScript layer for SSOT compliance

  ## Changes
  1. Remove position_size validation trigger (business logic)
  2. Keep data integrity constraints (min/max bounds)
  3. Validation now handled by ValidationGateway in TypeScript

  ## Rationale
  - Database should enforce data integrity, not business rules
  - Business rules change frequently, migrations are expensive
  - SSOT: ValidationGateway is the authority for validation
  - Enables consistent error messages and logging

  ## What Remains
  - Check constraints for basic bounds (prevent corruption)
  - Foreign key constraints (referential integrity)
  - Not null constraints (data completeness)
  - RLS policies (security)
*/

-- Drop the business logic validation trigger
DROP TRIGGER IF EXISTS validate_lot_size_trigger ON goal_session_trades;

-- Drop the validation function
DROP FUNCTION IF EXISTS validate_lot_size_before_insert();

-- Keep the check constraints for corruption prevention
-- These are data integrity, not business logic
DO $$
BEGIN
  RAISE NOTICE '✓ Business logic triggers removed';
  RAISE NOTICE '✓ Check constraints retained for data corruption prevention';
  RAISE NOTICE '✓ Validation authority: ValidationGateway (TypeScript layer)';
END $$;
