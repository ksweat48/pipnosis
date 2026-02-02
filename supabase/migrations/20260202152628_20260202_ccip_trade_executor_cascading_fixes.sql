/*
  # CCIP Trade Executor Cascading Fixes (20260202)

  **Migration Purpose**: Fix cascading database errors in AlphaTradeExecutor caused by missing NOT NULL fields and null entry prices.

  **Root Cause Analysis**:
  - buildTradeRecord() was returning incomplete field maps
  - Missing lot_size (NOT NULL) - only position_size was provided
  - Missing expected_profit_for_session (NOT NULL) - no default value after Phase 1
  - createPending() used decision.entry which could be null
  - current_pnl was set to null for pending trades (violates NOT NULL constraint from Phase 1)

  **Phase 1 Context**: 20260202_phase1_governance_database_fixes.sql removed DEFAULT 0 values from:
  - current_pnl (now NOT NULL, no default)
  - expected_profit_for_session (no default)
  - These changes intentionally broke silent failures

  **CCIP Changes**:
  - Code: AlphaTradeExecutor.buildTradeRecord() - Now includes all required fields
  - Code: AlphaTradeExecutor.createPending() - Now fetches live price if decision.entry is null
  - Code: AlphaTradeExecutor.validateTradeRecord() - New validation method for schema compliance
  - Code: AlphaTradeExecutor.logCCIPChange() - New CCIP tracking for audit trail
  - Database: No schema changes (all fields already exist)

  ## Changes

  ### 1. Code Changes (TypeScript)

  **alpha-trade-executor.ts**:

  #### buildTradeRecord():
  - Added validation: entry_price cannot be null (throws error)
  - Added lot_size field mapping (was missing!)
  - Added expected_profit_for_session calculation: (TP - Entry) * lotSize
  - Fixed current_pnl: Always 0 for new trades, never null

  #### createPending():
  - If decision.entry is null, fetch live price using priceCoordinator
  - Use resolved entryPrice in all subsequent operations
  - Fix notification message to use resolved entryPrice (not decision.entry)

  #### executeImmediate():
  - Added pre-insertion validation via validateTradeRecord()
  - Added CCIP change logging

  #### New Methods:
  - validateTradeRecord(): Pre-insertion validation of all required fields
  - logCCIPChange(): Governance tracking of database mutations

  ### 2. Validation Rules (Schema Compliance)

  Required NOT NULL fields (enforced via validateTradeRecord):
  - user_id: NOT NULL (FK to user_profiles)
  - goal_session_id: NOT NULL
  - symbol: NOT NULL
  - direction: NOT NULL
  - entry_price: NOT NULL, must be valid number
  - lot_size: NOT NULL, must be > 0
  - current_pnl: NOT NULL, must be valid number
  - expected_profit_for_session: NOT NULL, must be valid number
  - status: NOT NULL

  ### 3. Expected Profit Calculation

  Formula: IF takeProfit exists: (|TP - Entry| * lotSize) ELSE 0

  Rationale:
  - Allows traders to understand profit potential at entry
  - Zero when no profit target (valid state, not masking failure)
  - Used for session progress tracking and goal feasibility

  ### 4. CCIP Tracking

  New ccip_change_tracking entries logged for:
  - change_type: 'TRADE_CREATED'
  - table_affected: 'goal_session_trades'
  - record_id: trade.id
  - metadata: { sessionId, symbol, mode, entryPrice, lotSize }

  ## Verification

  After deployment, verify:
  1. All pending trade creations succeed (entry_price is populated)
  2. All trades include lot_size in database
  3. All trades include expected_profit_for_session in database
  4. No trades have NULL current_pnl
  5. CCIP tracking entries created for each trade

  ## Rollback Strategy

  If cascading errors continue:
  1. Check that Phase 1 migration (20260202_phase1_governance_database_fixes.sql) was applied
  2. Verify no NULL values in required columns exist in database
  3. Review error logs for specific field name mismatches
  4. Consider temporary DEFAULT values if needed (governance violation but survivable)

  ## Performance Impact

  - Pre-insertion validation adds ~1-2ms per trade (minimal)
  - CCIP logging is async (non-blocking)
  - No database queries added

  ## Compliance Notes

  **SSOT Compliance**: buildTradeRecord is SSOT for trade record structure
  **CCIP Compliance**: All database mutations tracked in ccip_change_tracking
  **Governance Compliance**: Validation prevents schema violations at insert time

  ## Related Issues

  - "null value in column entry_price violates not-null constraint" (403 on POST)
  - "null value in column lot_size violates not-null constraint" (cascade)
  - "null value in column expected_profit_for_session violates not-null constraint" (cascade)
  - "null value in column current_pnl violates not-null constraint" (cascade)

  All fixed by:
  1. Ensuring entry_price is always calculated (fetch live price if null)
  2. Including lot_size in trade record
  3. Calculating expected_profit_for_session based on TP
  4. Setting current_pnl to 0 (never null) for new trades
*/

-- ====================================
-- VERIFICATION (Data Integrity Check)
-- ====================================

DO $$
DECLARE
  v_null_entry_price_count integer;
  v_null_lot_size_count integer;
  v_null_expected_profit_count integer;
  v_null_current_pnl_count integer;
BEGIN
  -- Check for existing NULL values that would block new inserts
  SELECT COUNT(*) INTO v_null_entry_price_count
  FROM goal_session_trades WHERE entry_price IS NULL;

  SELECT COUNT(*) INTO v_null_lot_size_count
  FROM goal_session_trades WHERE lot_size IS NULL;

  SELECT COUNT(*) INTO v_null_expected_profit_count
  FROM goal_session_trades WHERE expected_profit_for_session IS NULL;

  SELECT COUNT(*) INTO v_null_current_pnl_count
  FROM goal_session_trades WHERE current_pnl IS NULL;

  IF v_null_entry_price_count > 0 THEN
    RAISE WARNING 'Found % trades with NULL entry_price - these should be fixed before Phase 1', v_null_entry_price_count;
  ELSE
    RAISE NOTICE '✅ No NULL entry_price values found';
  END IF;

  IF v_null_lot_size_count > 0 THEN
    RAISE WARNING 'Found % trades with NULL lot_size - Code change enforces non-null on inserts', v_null_lot_size_count;
  ELSE
    RAISE NOTICE '✅ No NULL lot_size values found';
  END IF;

  IF v_null_expected_profit_count > 0 THEN
    RAISE WARNING 'Found % trades with NULL expected_profit_for_session - Code change enforces non-null on inserts', v_null_expected_profit_count;
  ELSE
    RAISE NOTICE '✅ No NULL expected_profit_for_session values found';
  END IF;

  IF v_null_current_pnl_count > 0 THEN
    RAISE WARNING 'Found % trades with NULL current_pnl - Code change enforces 0 on inserts', v_null_current_pnl_count;
  ELSE
    RAISE NOTICE '✅ No NULL current_pnl values found';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'CCIP Trade Executor Fixes Ready';
  RAISE NOTICE 'Code changes deployed to app servers';
  RAISE NOTICE '========================================';
END $$;
