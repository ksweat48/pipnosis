/*
  # BTCUSD Per-Symbol Envelope Override and NoTradesFoundDialog Redesign

  ## Summary
  Governance documentation for two related frontend/config changes:

  1. **BTCUSD Per-Symbol Envelope Tiering**
     - BTCUSD's noise floor (~173 pips at $69K+) permanently exceeds the generic CRYPTO SCALP SL max (80 pips)
     - This caused persistent "constraint sandwich" rejections: BTCUSD was mathematically impossible to trade as a scalp
     - Added `symbolOverrides` to `StyleExecutionEnvelope` interface in `style-execution-envelopes.ts`
     - BTCUSD now has dedicated bounds across all 4 styles:
       - SCALP: TP 80-400, SL 40-250
       - MICRO_INTRADAY: TP 200-800, SL 100-400
       - INTRADAY: TP 400-1500, SL 200-700
       - SWING: TP 800-3000, SL 400-1200
     - Symbol overrides take priority over asset class defaults in `getAssetClassEnvelopeBounds()`
     - All callers (coordinator-alpha, omega9-hallucination-brain) updated to pass symbol
     - Added `getViableStyles()` utility for UI style suggestions

  2. **NoTradesFoundDialog Redesign**
     - Removed countdown timer, auto-close logic, and "Try Again" button
     - Single "Close Session" button only (SSOT: style immutability means no auto-switching)
     - Three contextual display modes:
       a) Constraint Sandwich: Amber warning explaining style/instrument incompatibility with pip details
       b) Weak Consensus: Gray info box about conflicting omega signals
       c) Default: Generic "no quality setups" message
     - Style suggestions are TEXT-ONLY (no action buttons) per governance requirement
     - NoTradeRejectionContext type flows through alpha-scan-no-trade CustomEvent

  ## SSOT Compliance
  - `getAssetClassEnvelopeBounds()` is the single authority for all envelope bounds
  - Symbol overrides checked first, then asset class defaults, then base defaults
  - No business logic duplication between UI and engine layers

  ## Files Modified
  - `src/config/style-execution-envelopes.ts` - symbolOverrides, getViableStyles, detectConstraintSandwich
  - `src/brains/coordinator-alpha.ts` - pass symbol to bounds resolution
  - `src/brains/omega9-hallucination-brain.ts` - pass symbol to bounds resolution
  - `src/services/best-symbol-selector.ts` - Constraint Sandwich classification
  - `src/services/goal-session-live-engine.ts` - NoTradeRejectionContext, buildRejectionContext
  - `src/components/NoTradesFoundDialog.tsx` - full redesign
  - `src/components/GoalSessionDashboard.tsx` - rejection context wiring
*/

SELECT 1;
