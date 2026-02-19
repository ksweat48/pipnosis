/*
  # CCIP Scalp Prompt Phase 2 — Full Information Architecture
  # 2026-02-19

  ## Summary
  Five targeted upgrades to the scalp trade style prompt system following
  Phase 1 (terminology unification, fallback block, token budget).
  No schema changes. Records governance changes to coordinator-alpha.ts
  and alpha-identity.ts.

  ## Changes Made

  ### 1. D1 Previous Day Context — Extended to All Styles (coordinator-alpha.ts)
  PDH/PDL was previously only injected for MICRO_INTRADAY and INTRADAY.
  SCALP scans now receive PDH/PDL as advisory context with SCALP-appropriate
  framing:
  - M5-scale: PDH/PDL are frequent liquidity sweep targets within scalp range
  - Scalp TP placement guidance relative to daily levels
  - Liquidity sweep of PDH/PDL explicitly identified as a high-probability setup
  - Advisory only — Alpha is not blocked by proximity to daily levels

  ### 2. M15 Structural Reference View — New for SCALP (coordinator-alpha.ts)
  A new M15 advisory block is injected for SCALP style (8 candles, non-blocking).
  Rationale: Scalps play out over 15-60 minutes. Alpha was placing scalp TPs
  with no visibility into M15 structure — the timeframe that governs where price
  stalls within the scalp window. The M15 block provides:
  - 8 most recent M15 candles with direction/body/wick data
  - M15 directional bias and range summary
  - Nearest M15 S/R as TP ceiling/floor for scalp targets
  - Headwind assessment when M15 trend conflicts with M5 entry direction
  - Positioned between HTF controlling TF and D1 context in prompt order
  - Data fetch failure is non-blocking (advisory only)

  ### 3. SCALP Hard Blocks Consolidated in System Prompt (alpha-identity.ts)
  Two new hard block entries added to the "HARD BLOCKS" section:
  - Block #9: SCALP ONLY — NO NAMED STRUCTURE (elevated from advisory red flag)
  - Block #10: SCALP ONLY — EXHAUSTED MOMENTUM (now explicitly in hard block list,
    previously only in Q9 and a standalone paragraph)
  
  A new "SCALP HARD BLOCK SUMMARY" section added before EXECUTION STANDARDS:
  - One-page quick reference listing all auto-block conditions for SCALP
  - Explicit separation of hard blocks vs advisory conditions
  - Prevents Alpha from treating advisory warnings as blocks (over-filtering)
    and prevents Alpha from treating hard blocks as suggestions (under-filtering)

  ### 4. No-Named-Structure Elevated to Hard Block (alpha-identity.ts)
  Previously a red flag: "A scalp without a named structure is a directional bet,
  not a trade" — buried in the KNOWN RISK PATTERNS section.
  Now a hard block (#9) with identical authority to geometry violations.
  The red flags section retains the entry for cross-reference.

  ### 5. DEVELOPING Momentum Instruction Fixed (alpha-identity.ts + coordinator-alpha.ts)
  Previous instruction: "reduce confidence by at least 10%"
  Problem: Arbitrary confidence penalty. Alpha's self-assessed confidence already
  reflects his market read. A code-imposed -10% distorts output without teaching
  Alpha what to do differently.
  
  New instruction: Assess and state remaining runway to TP explicitly.
  - "Remaining runway: ~X pips to nearest structure."
  - If runway supports TP: proceed with honest confidence
  - If runway does not support TP: tighten TP to nearest achievable structure
    or return NO_TRADE
  This is a structural reasoning requirement, not an arbitrary penalty.
  Applied consistently across: system prompt Q9, fallback self-assessment block,
  intelligence snapshot phase label, intelligence snapshot developing warning text.

  ## SSOT Compliance
  - alpha-identity.ts: SSOT for all Alpha system prompt content
  - coordinator-alpha.ts: SSOT for user prompt construction and data injection
  - No other files reference these prompt strings
  - No database schema changes required

  ## CCIP Protocol
  - System Map: alpha-identity.ts (system prompt) + coordinator-alpha.ts (user prompt)
  - Logic Contract: PDH/PDL expanded, M15 advisory added, hard blocks consolidated,
    no-named-structure promoted, DEVELOPING instruction corrected
  - Dry-Run: All changes are additive or clarifying; no blocking logic removed
  - Compatibility: M15 fetch is new (non-blocking); D1 fetch condition changed from
    `styleName === 'MICRO_INTRADAY' || 'INTRADAY'` to unconditional (all styles)
  - Staged Deployment: Single atomic migration
  - Post-Deploy Verification: SCALP scans should now show M15 and D1 context in
    prompt; Alpha should explicitly assess PDH/PDL and M15 S/R in scalp reasoning
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata,
  created_at
) VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"d1_styles": ["MICRO_INTRADAY","INTRADAY"], "m15_reference": false, "no_structure_is_hard_block": false, "developing_instruction": "reduce_confidence_10pct"}',
  '{"d1_styles": ["SCALP","MICRO_INTRADAY","INTRADAY"], "m15_reference": true, "no_structure_is_hard_block": true, "developing_instruction": "assess_remaining_runway"}',
  'CCIP-2026-02-19-PHASE2: Scalp full information architecture — PDH/PDL to SCALP, M15 advisory view, hard block consolidation, no-structure elevated, DEVELOPING instruction fixed',
  '{"ccip_id": "CCIP-2026-02-19-SCALP-PHASE2", "files": ["src/config/alpha-identity.ts", "src/brains/coordinator-alpha.ts"], "breaking": false, "new_data_fetches": ["M15 (SCALP only, non-blocking)", "D1 now includes SCALP"]}',
  now()
);
