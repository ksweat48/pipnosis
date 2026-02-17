/*
  # CCIP: Envelope-Only Style Walls Governance

  ## Change Control Intelligence Protocol (CCIP-2026-02-17)
  
  ### Title
  Remove noise floor as trade blocker -- envelope percentage bounds become sole style wall authority.

  ### Summary
  Previously, three overlapping wall systems could block Alpha from trading:
  1. Envelope percentage bounds (style identity)
  2. Noise floor (raised SL minimum above envelope min, could exceed envelope max)
  3. Constraint sandwich detection (if noise floor > envelope SL max, declared "NOT VIABLE")

  This created cascading failures:
  - Noise floor inflation via price-based floors on high-value instruments (US30, BTCUSD)
  - SSOT_MATH_CORRUPTION triggers requiring 1.5x envelope expansion hacks
  - Permanent constraint sandwiches blocking all trades on viable instruments
  - Style-aware ATR caps (3x for SCALP, 4x for MICRO) as bandaids
  - A phantom 200-pip fallback that made all style suggestions infeasible

  ### Changes Made

  1. **omega9-constraint-provider.ts**: SL minimum now uses envelope bounds only.
     Removed Math.max(envelopeMin, noiseFloor). Removed SSOT_MATH_CORRUPTION 1.5x expansion.
     Removed detectConstraintSandwich from arena wall builder. Arena always feasible.
     Noise floor presented as "Market Noise" advisory in prompts.

  2. **style-execution-envelopes.ts**: detectConstraintSandwich() now always returns
     sandwiched: false. Returns advisory text when noise exceeds envelope.
     getViableStyles() returns all styles unconditionally.

  3. **risk-aware-stop-calculator.ts**: Removed style-aware ATR caps (SCALP 3x, MICRO 4x).
     These were bandaids to prevent noise floor from triggering sandwiches.
     Noise floor calculation preserved as advisory market intelligence.

  4. **coordinator-alpha.ts**: Removed detectConstraintSandwich import.
     Wall check remains -- validates Alpha decisions against envelope bounds only.

  5. **goal-session-live-engine.ts**: Removed sandwich-based rejection context builder.
     Removed phantom 200-pip noise floor fallback.
     Constraint sandwich symbols array always empty.

  6. **best-symbol-selector.ts**: Reclassified "Constraint Sandwich" NO_TRADE category
     to "High Noise Advisory" for accurate diagnostics.

  7. **alpha-revision-handler.ts**: Changed "Noise Floor" label to "Market Noise (advisory)".

  ### Governance Principle
  Envelope percentage bounds define style identity. They are the walls.
  Noise floor is market intelligence that Alpha receives and factors into decisions.
  Alpha decides. The system enforces envelope walls. Nothing else blocks.

  ### Style Wall Authority (Post-Change)
  | What | Authority | Action |
  |------|-----------|--------|
  | SL/TP min/max per style | Envelope % bounds | HARD WALL -- blocks if violated |
  | SL/TP geometry | Coordinator wall check | HARD WALL -- blocks if wrong side |
  | Noise floor | Advisory in prompt | Alpha SEES it, decides accordingly |
  | R:R minimum | Advisory in prompt | Alpha SEES it, decides accordingly |

  ### No Schema Changes Required
  This is a frontend/service-layer governance change only.
  ArenaWalls.sandwiched is always false. ArenaWalls.feasible is always true.
  No database tables or columns affected.
*/

-- This migration documents the CCIP governance change.
-- No schema modifications required -- all changes are in the application layer.
-- The envelope percentage bounds in style-execution-envelopes.ts are the sole
-- authority for style wall enforcement per CCIP-2026-02-17.

SELECT 1 AS ccip_envelope_only_style_walls_governance_applied;
