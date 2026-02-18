/*
  # CCIP: Noise Floor Envelope Alignment Governance

  ## Summary
  Documents the governance decision to align style execution envelope SL minimums
  with noise floor percentages per asset class. This prevents the system from
  allowing stop losses that are below the statistical noise floor.

  ## Problem
  NAS100 SCALP trade was placed with 11.5 pip SL against a 37.0 pip noise floor.
  The envelope SL minimum for SCALP INDEX was 0.04% (producing ~9.9 pips at NAS100 prices),
  which is far below the INDEX noise floor of 0.15% of price.

  ## Root Cause
  The CCIP 2026-02-17 decision made noise floor "advisory only" and gave envelope
  percentages "sole style wall authority" -- but the envelope SL minimum percentages
  for INDEX instruments were set BELOW the noise floor percentage. The wall allowed
  SLs that normal market noise would trigger.

  ## Changes Made (Frontend Config, Not DB)
  1. style-execution-envelopes.ts: Raised all INDEX slPercent.min to >= 0.15% (noise floor)
  2. style-execution-envelopes.ts: Raised FOREX slPercent.min to >= 0.05% (noise floor)
  3. style-execution-envelopes.ts: Raised METAL slPercent.min to >= 0.20% (noise floor)
  4. style-execution-envelopes.ts: Adjusted TP min percentages and SL max to maintain valid ranges
  5. omega9-constraint-provider.ts: Strengthened noise floor text in prompt from "advisory" to directive
  6. alpha-identity.ts: Added NOISE FLOOR RULE to Alpha's system prompt

  ## Envelope Changes (SCALP):
  - INDEX: slPercent.min 0.04% -> 0.15% | slPercent.max 0.25% -> 0.35% | tpPercent.min 0.06% -> 0.20%
  - FOREX: slPercent.min 0.04% -> 0.05%
  - METAL: slPercent.min unchanged (0.15% already >= 0.20% noise -- WAIT, 0.15 < 0.20, so raised to 0.20%)

  ## Envelope Changes (MICRO_INTRADAY):
  - INDEX: slPercent.min 0.05% -> 0.15% | slPercent.max 0.25% -> 0.35% | tpPercent.min 0.08% -> 0.25%

  ## Envelope Changes (INTRADAY):
  - INDEX: slPercent.min 0.10% -> 0.15% | slPercent.max 0.20% -> 0.40% | tpPercent.min 0.25% -> 0.35%

  ## Validation (NAS100 at ~24675):
  - New SCALP SL min = 24675 * 0.15% / 100 = 37.0 pips (matches noise floor)
  - New SCALP SL max = 24675 * 0.35% / 100 = 86.4 pips (room for Alpha)
  - New SCALP TP min = 24675 * 0.20% / 100 = 49.4 pips (supports R:R >= 1.3)

  ## Validation (US30 at ~49532):
  - New SCALP SL min = 49532 * 0.15% / 100 = 74.3 pips (matches noise floor)
  - New SCALP SL max = 49532 * 0.35% / 100 = 173.4 pips

  ## CCIP Compliance
  - No new engines created
  - No hardcoded overrides
  - Alpha retains full authority within corrected walls
  - Envelope percentages remain sole wall authority (CCIP 2026-02-17 preserved)
  - Noise floor is now communicated as a professional directive, not just advisory
*/

SELECT 1 AS ccip_governance_documentation;