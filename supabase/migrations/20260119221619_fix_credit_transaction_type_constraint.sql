/*
  # Fix Credit Transaction Type Constraint - CCIP Compliant

  ## Problem Analysis
  The `token_transaction_history` table has a CHECK constraint that only allows specific
  transaction types. However, the credit-validation-service.ts is attempting to use
  transaction types that are NOT in the allowed list:
  
  - `signal_detected` (line 117) - Used when deducting credits for trading signals
  - `system_test` (line 232) - Used for credit system validation
  - `system_test_refund` (line 241) - Used to refund test credits
  
  This causes PostgreSQL error 23514: constraint violation, blocking all trading sessions.

  ## SSOT Principles
  - Single Source of Truth: This migration establishes the database constraint as the
    authoritative list of allowed transaction types
  - All code must use types defined here
  - Future transaction types must be added here first

  ## CCIP Compliance
  - Safe for production: Only ADDS transaction types, never removes
  - Backward compatible: Existing data remains valid
  - Non-breaking: All existing transaction types preserved
  - Validates before deploying

  ## Changes
  1. Drop the old constraint
  2. Create new constraint with additional transaction types:
     - `signal_detected` - Credits deducted for Alpha trading signals
     - `system_test` - Credits deducted during system health checks
     - `system_test_refund` - Credits refunded after successful test
     - `admin_credit` - Credits added by admin (already used in code)
  3. All original types preserved for backward compatibility

  ## Security
  - Transaction types are validated at database level
  - Cannot insert invalid transaction types
  - Maintains data integrity
*/

-- ============================================================================
-- SECTION 1: Validation Check
-- ============================================================================

DO $$
BEGIN
  -- Verify the constraint exists before attempting to drop it
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'token_transaction_history_transaction_type_check'
    AND conrelid = 'token_transaction_history'::regclass
  ) THEN
    RAISE EXCEPTION 'Expected constraint not found. Database may be in unexpected state.';
  END IF;

  RAISE NOTICE '✓ Constraint validation passed';
END $$;

-- ============================================================================
-- SECTION 2: Drop Old Constraint
-- ============================================================================

ALTER TABLE token_transaction_history
DROP CONSTRAINT IF EXISTS token_transaction_history_transaction_type_check;

-- ============================================================================
-- SECTION 3: Create New Constraint with Complete Type List
-- ============================================================================

ALTER TABLE token_transaction_history
ADD CONSTRAINT token_transaction_history_transaction_type_check
CHECK (transaction_type = ANY (ARRAY[
  -- Original types (preserved for backward compatibility)
  'signup_bonus'::text,
  'referral_reward'::text,
  'referral_earned'::text,
  'purchase_onetime'::text,
  'purchase_subscription'::text,
  'subscription_renewal'::text,
  'admin_adjustment'::text,
  'trade_evaluation'::text,
  'trade_check'::text,
  'position_analysis'::text,
  -- NEW types required by credit-validation-service.ts
  'signal_detected'::text,          -- Used when deducting credits for signals
  'system_test'::text,              -- Used for system health validation
  'system_test_refund'::text,       -- Used to refund test credits
  'admin_credit'::text              -- Used when admin adds credits (already in code)
]));

-- ============================================================================
-- SECTION 4: Verification
-- ============================================================================

DO $$
DECLARE
  v_constraint_def text;
BEGIN
  -- Get the new constraint definition
  SELECT pg_get_constraintdef(oid) INTO v_constraint_def
  FROM pg_constraint
  WHERE conname = 'token_transaction_history_transaction_type_check'
  AND conrelid = 'token_transaction_history'::regclass;

  -- Verify it contains the new types
  IF v_constraint_def NOT LIKE '%signal_detected%' THEN
    RAISE EXCEPTION 'Constraint missing signal_detected type';
  END IF;

  IF v_constraint_def NOT LIKE '%system_test%' THEN
    RAISE EXCEPTION 'Constraint missing system_test type';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ Credit Transaction Type Constraint Fixed';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '✓ Added: signal_detected';
  RAISE NOTICE '✓ Added: system_test';
  RAISE NOTICE '✓ Added: system_test_refund';
  RAISE NOTICE '✓ Added: admin_credit';
  RAISE NOTICE '';
  RAISE NOTICE '✓ All original types preserved';
  RAISE NOTICE '✓ Credit system should now function correctly';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SECTION 5: Comments (SSOT Documentation)
-- ============================================================================

COMMENT ON CONSTRAINT token_transaction_history_transaction_type_check 
ON token_transaction_history IS 
'SSOT: Authoritative list of allowed credit transaction types. 
Any new transaction type must be added here first before use in application code.
Last updated: 2026-01-19 - Added signal_detected, system_test, system_test_refund, admin_credit';

COMMENT ON COLUMN token_transaction_history.transaction_type IS
'Type of credit transaction. Must match one of the types defined in the table CHECK constraint.
See constraint token_transaction_history_transaction_type_check for complete list.';
