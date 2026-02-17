/*
  # CCIP Governance: INTRADAY R:R Hierarchy and Prompt Enrichment

  ## Summary
  Establishes a proper reward-to-risk hierarchy across all trade styles,
  enriches the INTRADAY style prompt to match SCALP and MICRO_INTRADAY richness,
  and tightens INTRADAY INDEX percent bounds to prevent absurd SL/TP values.

  ## Changes

  ### 1. R:R Hierarchy Enforcement (SSOT Constants)
  - SCALP: Single TP >= 1.3:1 (unchanged)
  - MICRO_INTRADAY: TP1 >= 1.5:1, TP2 >= 2.0:1 (unchanged)
  - INTRADAY: TP1 >= 2.0:1 (was 1.5:1), TP2 >= 2.5:1 (was 2.0:1)

  Rationale: INTRADAY uses bigger timeframe (H1 vs M15), bigger SL envelope
  (30-60 pips vs 15-50), and holds 2-10 hours. More exposure demands more reward.
  Identical R:R walls between MICRO_INTRADAY and INTRADAY was architecturally wrong.

  ### 2. INTRADAY Prompt Enrichment (alpha-identity.ts, coordinator-alpha.ts)
  - Added H4 SL validation context (was missing)
  - Added anti-pattern warnings: "Do NOT target M15 micro-structure" and "Do NOT target D1 pools"
  - Added TP conservative edge placement rule (was only on SCALP)
  - Added negative expectancy warning for micro-level TP1 with wide SL
  - Made fallback instruction self-contained (removed "same principle" cross-reference)

  ### 3. MICRO_INTRADAY Prompt Enhancement
  - Added TP conservative edge placement rule for both TP1 and TP2
  - Added anti-pattern: "Do NOT target D1 or H4 pools"

  ### 4. INTRADAY INDEX Percent Bounds Tightening (style-execution-envelopes.ts)
  - INDEX slPercent max: 0.60% -> 0.20% (prevents 294-pip SL on US30; max ~98 pips)
  - INDEX tpPercent max: 1.50% -> 0.45% (prevents 735-pip TP on US30; max ~220 pips)

  ### 5. Omega9 Constraint Provider (omega9-constraint-provider.ts)
  - Updated TP1/TP2 R:R WALLS section in dual-arena prompt to show new INTRADAY floors

  ## Affected Files
  - src/config/trading-constants.ts (SSOT constants)
  - src/config/alpha-identity.ts (Alpha system prompt)
  - src/config/style-execution-envelopes.ts (INDEX bounds)
  - src/brains/coordinator-alpha.ts (Coordinator TP guidance)
  - src/services/omega9-constraint-provider.ts (Dual-arena prompt)

  ## Security
  No RLS or schema changes. This is a governance audit record only.

  ## CCIP Protocol
  - System Map: All 5 prompt/constant surfaces identified and updated
  - Logic Contract: R:R hierarchy SCALP 1.3 < MICRO TP1 1.5/TP2 2.0 < INTRADAY TP1 2.0/TP2 2.5
  - Compatibility: Enforcement code reads from SSOT constants (getMinTP1RRForStyle, getMinRRForStyle)
  - Staged Deployment: Constants + prompts + envelope bounds updated atomically
  - Post-Deploy: Existing open trades unaffected; new scans will use updated R:R walls
*/

SELECT 1 AS ccip_governance_audit_record;
