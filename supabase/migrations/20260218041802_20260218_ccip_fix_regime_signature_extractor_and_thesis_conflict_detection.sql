/*
  # CCIP: Fix Regime Signature Extractor & Add Thesis-Omega Conflict Detection

  ## Root Cause Analysis
  Two compounding bugs in regime-signature-extractor.ts caused the thesis cache to serve
  stale theses that contradicted current market conditions:

  1. **Property Name Mismatch**: Extractor read `votes.omega1`, `votes.omega2`, etc. but the
     actual OmegaCouncilVotes interface uses `votes.trend`, `votes.scalper`, `votes.confirmation`,
     `votes.reversal`, `votes.volatility`, `votes.risk`, `votes.omega8`. All lookups returned undefined.

  2. **Deprecated Field Access**: Even if property names matched, the extractor read
     `vote.confidence` and `vote.direction` which were deprecated (CCIP-2026-02-16) and always
     undefined. The actual Omega output uses `vote.reasoning` (text) and `vote.keyFactors` (array).

  ## Impact
  - Regime signature was STATIC: always `{ranging, trending, normal_volatility, choppy}`
  - Thesis cache NEVER invalidated on market regime changes
  - Alpha was served stale cached theses with wrong directional bias
  - Led to at least one documented incident of SELL trade executed during BULLISH conditions

  ## Fixes Applied

  ### 1. regime-signature-extractor.ts (Complete Rewrite)
  - Fixed property names: `votes.omega1` → `votes.trend`, etc.
  - Parse `reasoning` field for bias and score (format: "[DET] Brain BIAS (score: N)")
  - Parse `keyFactors` array for structural signals (BOS_BULL, EMA_BEAR, etc.)
  - Imported SSOT OmegaCouncilVotes from types/omega.ts (not local redefinition)
  - Removed stale local OmegaCouncilVotes interface that used omega1/omega2/etc.

  ### 2. coordinator-alpha.ts (Conflict Detection + Omega Verification)
  - Added `detectOmegaThesisConflict()`: Checks if 2+ Omega specialists (Trend, Confirmation,
    OrderFlow) signal a direction that contradicts the cached thesis. If conflict detected,
    cached thesis is invalidated and Alpha generates fresh analysis.
  - Added `buildOmegaVerificationSummary()`: Injects current Omega specialist reasoning into
    the cached thesis prompt so Alpha can make an informed accept/reject decision.
  - Modified cached thesis prompt: Now includes "CURRENT OMEGA SPECIALIST INTELLIGENCE" section
    with each specialist's reasoning, giving Alpha the data needed to verify.

  ## Governance Compliance
  - SSOT: OmegaCouncilVotes imported from types/omega.ts (single source of truth)
  - SSOT: Omega output format parsed from actual runtime values, not deprecated fields
  - CCIP: Full audit trail via this migration
  - No database schema changes required (code-only fix)

  ## Verification
  After this fix:
  - Regime signatures will vary based on actual market conditions
  - Thesis cache will invalidate when market regime changes
  - Alpha will see Omega intelligence when verifying cached theses
  - Direct contradictions (e.g., SELL thesis + 2+ BUY Omegas) are auto-invalidated
*/

SELECT 1 AS ccip_regime_signature_fix_applied;
