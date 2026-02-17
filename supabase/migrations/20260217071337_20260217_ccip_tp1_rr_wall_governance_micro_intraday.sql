/*
  # CCIP Governance: TP1 R:R Hard Wall Enforcement for MICRO_INTRADAY and INTRADAY

  ## Problem Statement
  Alpha placed a MICRO_INTRADAY US30 SELL trade with:
  - Entry: 49320.0, SL: 49394.0 (74 pips), TP1: 49291.0 (29 pips), TP2: 49062.4 (258 pips)
  - TP1 R:R = 29/74 = 0.39:1 (catastrophic -- scalp-level targeting on micro intraday trade)
  - TP2 R:R = 258/74 = 3.48:1 (excellent but irrelevant if SL hits first)
  - R:R validation only checked TP2, not TP1 -- so the trade passed all gates

  ## Root Cause
  1. No TP1 minimum R:R rule existed in Alpha's prompt or constants
  2. R:R and arena wall validation only checked TP2 (takeProfit), never TP1
  3. MICRO_INTRADAY style contract was a single line with no TP1/TP2 guidance
  4. SL envelope max (40 pips) was informational only, not enforced via walls

  ## Changes Made (All Frontend/Prompt -- No Schema Changes)

  ### 1. trading-constants.ts (SSOT)
  - Added MINIMUM_TP1_MICRO_INTRADAY: 1.5 (TP1 R:R floor)
  - Added MINIMUM_TP1_INTRADAY: 1.5 (TP1 R:R floor)
  - Added getMinTP1RRForStyle() helper function
  - Existing TP2 minimums unchanged (MICRO_INTRADAY: 2.0, INTRADAY: 2.0)

  ### 2. alpha-identity.ts (System Prompt)
  - Expanded MICRO_INTRADAY style contract: M15 chart, H1 validation, 1-6 hours
    - TP1 at M15 structural level (NOT M5 micro-structure)
    - TP1 R:R >= 1.5:1 (HARD WALL)
    - TP2 at H1 structural level, R:R >= 2.0:1 (HARD WALL)
  - Expanded INTRADAY style contract: H1 chart, H4 validation
    - TP1 at H1 structure, R:R >= 1.5:1
    - TP2 at H4 structure, R:R >= 2.0:1
  - Fixed R:R inconsistency: SCALP unified to 1.3:1 across all prompt sections
  - Added TP1 R:R to CONSTRAINTS section with explicit hard wall language

  ### 3. coordinator-alpha.ts (Enforcement)
  - TP prompt guidance: Added R:R floors and structural timeframe anchors for TP1/TP2
  - TP1 R:R validation: Hard block if TP1 R:R < style minimum (logs ALPHA_TP1_RR_WALL_VIOLATION)
  - Arena wall check: Now validates TP1 against arena TP walls (was only checking TP2)
  - Both violations produce NO_TRADE with detailed reasoning

  ### 4. style-execution-envelopes.ts
  - MICRO_INTRADAY SL max: 40 -> 50 pips (accommodates M15/H1 structural SL)
  - INDEX slPercent max: 0.40 -> 0.12 (was 197 pips at US30 prices, now ~60 pips)

  ### 5. omega9-constraint-provider.ts
  - Arena prompt now includes explicit TP1/TP2 R:R walls section
  - Alpha sees both TP1 and TP2 R:R requirements in the constraint prompt

  ## Impact
  - The US30 SELL trade that triggered this would now be blocked at two points:
    1. TP1 R:R wall (0.39:1 < 1.5:1 minimum)
    2. TP1 arena wall (29 pips < TP wall minimum)
  - Alpha retains sole authority for TP placement WITHIN the walls
  - No percentage rules between TP1 and TP2 -- walls only

  ## Compliance
  - SSOT: All R:R constants in trading-constants.ts, referenced by prompt and enforcement
  - CCIP: Change tracked via migration, no silent behavior changes
  - Governance: Hard walls with violation logging, not advisory-only
*/

SELECT 1;
