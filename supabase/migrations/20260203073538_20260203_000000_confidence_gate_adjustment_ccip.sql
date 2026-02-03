/*
  # Confidence Gate Adjustment - Production Trade Execution Fix

  ## Summary

  CRITICAL FIX: Lower minimum trade confidence threshold from 60% to 50% to enable viable trades
  at 52-55% confidence with intelligent degradation via EQS penalty system.

  Production Impact: Enables execution of valid setups that were previously blocked.
  Philosophy: Engines validate. Alpha decides. Trades degrade intelligently.

  ## Changes Made

  1. **Code Configuration Change**
     - File: `src/config/alpha-identity.ts`
     - Change: `MINIMUM_TRADE_CONFIDENCE: 60` → `MINIMUM_TRADE_CONFIDENCE: 50`
     - Reason: 60% threshold was blocking viable trades at 52-55% confidence
     - Safety: EQS penalties (-30 to +5) still enforce intelligent degradation

  2. **Confidence Bands Updated**
     - ACCEPTABLE: 50-69% (was 60-69%)
     - INSUFFICIENT: <50% (was <60%)
     - No breaking changes to existing logic

  3. **Governance Tracking**
     - CCIP Change Request registered: `CCIPConfidenceGateAdjustment`
     - Service: `src/services/ccip-confidence-gate-adjustment.ts`
     - All 6 CCIP phases documented

  ## Problem Statement

  - SPX500 at 52% confidence rejected (< 60% minimum)
  - Other symbols (XAUUSD, US30, NAS100) rejected by Omega-9 constraints
  - Lot sizing showing $16 profit vs $290 goal profit expectation
  - Silent failures: No user notification why trades rejected
  - Production impact: 0% successful execution rate on viable 52-55% confidence setups

  ## Solution Approach

  1. **Baseline Adjustment**: Lower minimum from 60% to 50%
  2. **Intelligent Degradation**: EQS penalties naturally create WAIT recommendations
  3. **Validation Preservation**: Omega-9 constraints still enforce safe SL/TP geometry
  4. **User Feedback**: (Follow-up) Add rejection reason notifications

  ## CCIP Phases

  1. ✅ Phase 1: System mapping - Confidence gates and EQS penalty system documented
  2. ✅ Phase 2: Logic contract - 50% baseline with EQS-based degradation
  3. ✅ Phase 3: Dry-run - Tested with SPX500 and other stuck symbols
  4. ✅ Phase 4: Compatibility - No breaking changes, backward compatible
  5. ✅ Phase 5: Staged deployment - Configuration change deployed
  6. ⏳ Phase 6: Post-deploy verification - Monitor trade execution success rate

  ## Risk Assessment

  **Low Risk:**
  - Single constant change in configuration file
  - No database schema changes
  - No breaking changes to existing APIs
  - Rollback: Simple revert of one configuration value

  ## Monitoring

  - CCIP change request registered for audit trail
  - Monitor: Trade execution success rate on 50-60% confidence trades
  - Alert: If execution rate drops (indicates unforeseen issue)

  This migration is documentation-only. No database operations needed.
*/

-- This migration is documentation-only for governance tracking
-- The actual change is in src/config/alpha-identity.ts (MINIMUM_TRADE_CONFIDENCE: 60 → 50)
-- No database schema changes required
-- CCIP change tracking registration happens in application startup via CCIPConfidenceGateAdjustment service
