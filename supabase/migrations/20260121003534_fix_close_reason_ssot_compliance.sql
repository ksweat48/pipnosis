/*
  # Fix Close Reason SSOT Compliance - CRITICAL PRODUCTION FIX

  ## CCIP Root Cause Analysis

  ### Critical Issue:
  TypeScript coordinator uses close_reason values that don't match database constraint,
  causing trade closures to FAIL with constraint violation errors.

  ### Root Cause:
  Three different CloseReason enum definitions across codebase:
  1. `trade-closure-coordinator.ts` uses: 'goal_met', 'session_timeout', 'force_close', 'weekend_shutdown'
  2. `src/types/position.ts` uses: 'weekend_protection', 'holiday_closure', 'force_closed'
  3. Database constraint expects specific values from migration 20260119053122

  ### SSOT Violation:
  No single source of truth for close_reason values - coordinator, types, and database
  all have different definitions.

  ### Impact:
  - Trades closed with 'goal_met' → DATABASE CONSTRAINT ERROR
  - Trades closed with 'session_timeout' → DATABASE CONSTRAINT ERROR
  - Trades closed with 'force_close' → DATABASE CONSTRAINT ERROR
  - Trades closed with 'weekend_shutdown' → DATABASE CONSTRAINT ERROR

  ### CCIP Compliance:
  1. ✅ System Map: Audited all close_reason usages across codebase
  2. ✅ Logic Contract: Standardize on database constraint as SSOT
  3. ✅ Dry-Run: Verified constraint definition via information_schema
  4. ✅ Compatibility: No data migration needed (fixing future inserts only)
  5. ✅ Staged: Production-safe - adds logging, no breaking changes
  6. ✅ Verification: Updated TypeScript types to match database

  ### Fix Strategy:
  1. Database is SSOT (constraint is authoritative)
  2. Update all application code to use database values
  3. Add helper function to validate close_reason before insert

  ## Changes:
  1. Document the authoritative close_reason values
  2. Create validation function for application use
  3. TypeScript types already updated in application layer
  4. No schema changes needed (constraint is correct)
*/

-- ============================================================================
-- Close Reason SSOT Documentation
-- ============================================================================

COMMENT ON CONSTRAINT goal_session_trades_close_reason_check ON goal_session_trades IS
'SSOT for close_reason values - ALL application code must use these exact values:
- manual: User manually closed the trade
- stop_loss: Stop loss was hit
- take_profit: Original take profit was hit
- take_profit_1: First take profit (TP1) milestone hit
- take_profit_2: Second take profit (TP2) hit - full close
- goal_achieved: Trading goal was achieved
- goal_expired: Goal session expired
- session_ended: Trading session ended normally
- risk_limit: Risk limit was exceeded
- trailing_stop: Trailing stop was hit
- timeout: Session timeout (NOT session_timeout)
- safety_net: Safety mechanism triggered
- user_stopped: User explicitly stopped the session
- breakeven: Breakeven stop was hit
- alpha_override: Alpha overrode the trade decision
- ai_decision: AI made the close decision
- weekend_protection: Weekend shutdown (NOT weekend_shutdown)
- holiday_closure: Holiday market closure
- force_closed: Admin force closed (NOT force_close)
- market_closed: Market closed unexpectedly

CRITICAL: Application MUST NOT use these deprecated values:
- goal_met (use goal_achieved)
- session_timeout (use timeout)
- force_close (use force_closed)
- weekend_shutdown (use weekend_protection)

System close reasons (excluded from Alpha learning):
- weekend_protection, holiday_closure, force_closed, market_closed';

-- ============================================================================
-- Create Close Reason Validation Helper Function
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_close_reason(p_close_reason text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_close_reason = ANY (ARRAY[
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit',
    'trailing_stop', 'timeout', 'safety_net', 'user_stopped',
    'breakeven', 'alpha_override', 'ai_decision',
    'weekend_protection', 'holiday_closure', 'force_closed', 'market_closed'
  ]);
END;
$$;

COMMENT ON FUNCTION validate_close_reason IS
'Validates close_reason against SSOT constraint - use in application code before inserts';

GRANT EXECUTE ON FUNCTION validate_close_reason TO authenticated;
GRANT EXECUTE ON FUNCTION validate_close_reason TO service_role;

-- ============================================================================
-- Create Migration Audit Log
-- ============================================================================

DO $$
BEGIN
  -- Log any existing trades with non-standard close reasons (should be none in production)
  IF EXISTS (
    SELECT 1 FROM goal_session_trades
    WHERE status = 'closed'
    AND close_reason IS NOT NULL
    AND NOT validate_close_reason(close_reason)
  ) THEN
    RAISE WARNING 'Found trades with non-standard close_reason values - these will fail on future updates';
    
    -- Log details for investigation
    RAISE NOTICE 'Non-standard close_reason values found: %',
      (SELECT array_agg(DISTINCT close_reason)
       FROM goal_session_trades
       WHERE status = 'closed'
       AND close_reason IS NOT NULL
       AND NOT validate_close_reason(close_reason));
  END IF;
END $$;

-- ============================================================================
-- Governance Compliance Log
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Close Reason SSOT Fix Applied';
  RAISE NOTICE '  - Database constraint is authoritative SSOT';
  RAISE NOTICE '  - TypeScript types updated in application layer';
  RAISE NOTICE '  - Validation helper function created';
  RAISE NOTICE '  - Deprecated values documented';
  RAISE NOTICE '  - System close reasons preserved for learning exclusion';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  Application code MUST use these exact values:';
  RAISE NOTICE '  - timeout (NOT session_timeout)';
  RAISE NOTICE '  - force_closed (NOT force_close)';
  RAISE NOTICE '  - weekend_protection (NOT weekend_shutdown)';
  RAISE NOTICE '  - goal_achieved (NOT goal_met)';
END $$;
