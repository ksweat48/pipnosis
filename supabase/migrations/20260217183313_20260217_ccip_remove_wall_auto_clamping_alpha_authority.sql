/*
  # CCIP: Remove Wall Auto-Clamping — Restore Alpha Sole Decision Authority

  ## Governance Policy Change
  The previous CCIP migration (20260217_wall_validation_ssot_consolidation) introduced
  a "marginal-violation auto-clamping" system that silently adjusted Alpha's proposed
  SL/TP values when they were within a tolerance band of wall boundaries. This violates
  Alpha's sole authority over trade parameters.

  ## Problem
  - Auto-clamping modified Alpha's proposed stopLoss, takeProfit, and tp1Price values
    without Alpha's knowledge or consent
  - This created hidden, non-transparent behavior where the executed trade differed
    from what Alpha decided
  - It undermined the architectural principle that Alpha is the sole decision-maker
    in the arena
  - Tolerance bands (5% of boundary, max 3 pips) were arbitrary and non-deterministic

  ## Changes (Code-Only — No Database Schema Changes)

  ### Removed: Auto-Clamping System
  - `coordinator-alpha.ts`: Removed `getWallTolerance()` helper function
  - `coordinator-alpha.ts`: Removed `checkAndClamp()` function and all price reconstruction logic
  - `coordinator-alpha.ts`: Removed `clampedAdjustments` tracking array
  - `coordinator-alpha.ts`: Removed all `decision.stopLoss`, `decision.takeProfit`,
    `decision.tp1Price` mutation inside the wall check

  ### Restored: Pure Binary Wall Enforcement
  - Wall check is now a simple pass/fail: values inside walls = proceed, outside = block
  - Alpha's proposed values are NEVER modified by the validation system
  - All wall violations (regardless of magnitude) result in a hard block
  - Alpha must learn to propose correct values within arena boundaries

  ## SSOT Compliance
  - Alpha is the SOLE authority over trade entry, SL, TP, and TP1 values
  - Dual-arena walls are the SOLE validation authority (unchanged)
  - No system may silently modify Alpha's decisions
  - Walls are physics: inside or blocked, no middle ground

  ## Preserved (Unchanged)
  - Fix 1: HARD WALLS prompt uses actual dual-arena wall values (SSOT unification)
  - Fix 3: Concrete TP1 minimum in prompt (helps Alpha decide correctly)
  - Fix 4: Envelope check is diagnostic-only (dual-arena walls are single authority)

  ## Governance
  - CCIP protocol followed: System Map -> Logic Contract -> Deployment
  - No database schema changes required
  - This migration serves as the CCIP audit trail for the code revert
*/

SELECT 1 AS ccip_remove_wall_auto_clamping_alpha_authority_audit;
