/*
  # CCIP: Fix MICRO_INTRADAY Three Blocking Mechanisms

  ## Summary
  Three independent constraint systems were creating a structural impossibility
  that prevented ALL trades in MICRO_INTRADAY style. This migration documents
  the governance-compliant fixes applied to coordinator-alpha.ts.

  ## Root Cause Analysis

  ### Blocker A: TP1 R:R Hard Wall (affected 5/9 symbols)
  The TP1 R:R minimum of 1.5:1 required TP1 distance >= 1.5x SL distance.
  When noise floors inflated SL (e.g., 60+ pips for indices), TP1 at 1.5x SL
  would exceed TP2, which is logically impossible since TP1 is a partial-profit
  target that by definition sits between entry and TP2.

  **Fix**: Removed TP1 R:R hard block from parseDecision(). The dual-arena wall
  check in coordinate() is the SSOT validation authority. TP1 R:R check is now
  diagnostic-only (logged but not blocking).

  ### Blocker B: Stop Calculator vs Wall Minimum Conflict (affected XAUUSD)
  The Stop Calculator clamped SL to profile minimum (10 pips from risk strategy),
  but Omega-9 envelope alignment raised the wall minimum to 12.2 pips based on
  noise floor and asset class bounds. The SL anchor shown to Alpha was 10 pips,
  but the wall rejected anything below 12.2 pips.

  **Fix**: SL anchor recommendations are now lifted to the wall minimum if they
  fall below it. The confusing "Profile Range" line was removed from the LLM
  prompt -- only the HARD WALLS line (which uses dual-arena wall values) is shown.

  ### Blocker B.2: TP1 Validated Against Full TP Wall Minimum
  The dual-arena wall check validated TP1 against arena.tpPips.min, which
  represents the full-target R:R floor (e.g., 2.0:1 minimum for MICRO_INTRADAY).
  TP1 is a partial-profit target and cannot meet the full-target minimum.

  **Fix**: TP1 wall validation now checks only that TP1 > 0 pips (positive
  direction) and TP1 <= TP2 (partial target cannot exceed full target).
  Full TP wall range validation applies only to TP2/takeProfit.

  ## SSOT Compliance
  - Dual-arena wall check remains the single validation authority for all trade parameters
  - Alpha remains sole decision authority for SL/TP/TP1 values
  - No auto-adjustment or silent modification of Alpha's decisions
  - Wall violations remain hard blocks (binary pass/fail)

  ## Affected Files
  - `src/brains/coordinator-alpha.ts`: Three targeted changes in parseDecision() and coordinate()

  ## Security
  - No schema changes
  - No RLS changes
  - No new tables or columns
*/

SELECT 1;
