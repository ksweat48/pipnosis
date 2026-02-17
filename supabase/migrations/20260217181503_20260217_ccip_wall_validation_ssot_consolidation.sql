/*
  # CCIP: Wall Validation SSOT Consolidation - Fix Systematic Trade Blocking

  ## Problem
  Alpha Coordinator was systematically blocked from executing ANY trades due to
  four cascading root causes in the wall validation architecture:
  
  1. **Conflicting Wall Information (SSOT Violation)**: The "HARD WALLS" prompt line
     used raw envelope bounds (no noise floor), while validation used dual-arena walls
     (with noise floor). Alpha received contradictory ranges.
  
  2. **Zero Tolerance in Wall Validation**: LLMs are inherently imprecise with numeric
     values. A 0.1 pip violation caused the same full block as a 50 pip violation.
  
  3. **Missing Concrete TP1 Minimum**: The prompt told Alpha "TP1 R:R >= 1.5:1" but
     never calculated the concrete minimum TP1 in pips. With noise floor forcing SL
     to 36.9 pips, TP1 must be >= 55.4 pips, but Alpha wasn't told this number.
  
  4. **Redundant Validation Layers**: Two separate wall checks (dual-arena + raw envelope)
     used different data sources and could produce conflicting results.

  ## Changes (Code-Only - No Database Schema Changes)
  
  ### Fix 1: HARD WALLS Prompt SSOT Unification
  - `coordinator-alpha.ts`: The HARD WALLS line now uses actual dual-arena wall values
    (which include noise floor) instead of raw envelope bounds
  - SSOT: Alpha sees ONE consistent set of wall numbers matching what it's validated against
  
  ### Fix 2: Marginal-Violation Auto-Clamping
  - `coordinator-alpha.ts`: Wall check now distinguishes marginal violations (within 5%
    tolerance, max 3 pips) from significant violations
  - Marginal violations: auto-clamp to wall boundary, log warning, proceed with trade
  - Significant violations: hard-block as before (confidence = 0%)
  - Handles LLM imprecision (e.g., SL 10.0 vs wall min 10.2)
  
  ### Fix 3: Concrete TP1 Minimum in Prompt
  - `omega9-constraint-provider.ts`: formatDualArenaForPrompt now includes computed
    TP1 minimum in pips (e.g., "CONCRETE TP1 MINIMUM: IF LONG TP1 >= 55.4 pips")
  - Uses getMinTP1RRForStyle from SSOT trading-constants
  - Alpha gets concrete numbers instead of needing to do floating-point R:R math
  
  ### Fix 4: Envelope Wall Check -> Diagnostic Only
  - `coordinator-alpha.ts`: The separate envelope wall check in parseDecision() is now
    diagnostic-only (logs warning but does NOT block trades)
  - SSOT: Dual-arena wall check in coordinate() is the SINGLE validation authority
  - Eliminates double-jeopardy from two competing validation layers

  ## Governance
  - All changes follow CCIP protocol (System Map -> Logic Contract -> Deployment)
  - No database schema changes required (changes are prompt/validation logic only)
  - This migration serves as the CCIP audit trail for the code changes

  ## Impact
  - Eliminates systematic wall violation blocks that prevented ALL trades
  - Preserves constraint governance (significant violations still hard-blocked)
  - Improves Alpha's ability to propose values within walls (better prompt guidance)
*/

SELECT 1 AS ccip_wall_validation_ssot_consolidation_audit;
