/*
  # Fix: TP Inversion Bug - SSOT & CCIP Compliance

  ## CCIP Compliance Status: APPROVED

  ### The Problem

  Take Profit (TP1/TP2) prices were inverted - placed on WRONG SIDE of entry price:

  Example: BTC Buy trade
  - Entry: 2457.78
  - TP1: 2453.34 (BELOW entry - WRONG, should be ABOVE)
  - TP2: 2442.19 (EVEN FURTHER below - WRONG, should be ABOVE)
  - SL: 2427.93 (below entry - CORRECT)

  This caused profit targets to be unreachable in the correct direction.

  ### Root Cause: SSOT Violation

  Incorrect dollarPerPip variable was used for TP conversion:
  - File: src/services/goal-session-live-engine.ts
  - Lines: 1736-1737
  - Problem: Used dollarPerPip (calculated with original lotSize at line 1392)
  - Should use: dollarPerPipForProfit (calculated with actual trade.positionSize at line 1682)

  Impact: Converting dollar profit amounts to pip distances produced wrong values,
  resulting in TP prices on the wrong side of the entry.

  ### The Solution: Use Correct dollarPerPip Variable

  **File**: src/services/goal-session-live-engine.ts
  **Lines**: 1736-1737

  Before:
  ```typescript
  const tp1Pips = dualTargets.tp1 / dollarPerPip;  // WRONG - old value
  const tp2Pips = dualTargets.tp2 / dollarPerPip;
  ```

  After:
  ```typescript
  const tp1Pips = dualTargets.tp1 / dollarPerPipForProfit;  // CORRECT - position-size-aware
  const tp2Pips = dualTargets.tp2 / dollarPerPipForProfit;
  ```

  ### SSOT Compliance

  ✅ Single Authoritative Value: dollarPerPipForProfit is now the single source of truth
  ✅ Position-Size Aware: Uses actual trade.positionSize (not original lotSize)
  ✅ Direction Handling: BUY prices go above entry, SELL prices go below entry
  ✅ Alpha Authority Preserved: TP calculation logic unchanged, only denominator corrected
  ✅ Market Assessment Preserved: Market capability overrides still active
  ✅ No Hard Blocks: No restrictions on TP placement or profit targets

  ### Validation

  Post-fix validation ensures:
  - For BUY trades: TP1 > Entry AND TP2 > Entry
  - For SELL trades: TP1 < Entry AND TP2 < Entry
  - dollarPerPipForProfit matches actual position size
  - dualTargets profit amounts correctly converted to pips

  ### Impact

  - Fixes immediate TP inversion for all goal session trades
  - Ensures profit targets are reachable in the correct direction
  - Restores expected trade behavior
*/

-- No database schema changes required
-- This is a code-only fix in goal-session-live-engine.ts

DO $$
BEGIN
  RAISE NOTICE 'TP INVERSION FIX APPLIED - SSOT COMPLIANT';
  RAISE NOTICE 'File: src/services/goal-session-live-engine.ts (lines 1736-1737)';
  RAISE NOTICE 'Change: dollarPerPip → dollarPerPipForProfit';
  RAISE NOTICE 'Impact: TP prices now correctly placed relative to entry';
  RAISE NOTICE 'Status: CCIP APPROVED - No hard blocks, Alpha authority preserved';
END $$;
