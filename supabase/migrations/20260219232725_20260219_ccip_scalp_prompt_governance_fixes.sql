/*
  # CCIP Scalp Prompt Governance Fixes — 2026-02-19

  ## Summary
  Three targeted corrections to the scalp trade style prompt system.
  No schema changes required. This migration records the governance changes
  made to coordinator-alpha.ts and alpha-identity.ts.

  ## Changes Made

  ### 1. Terminology Unification — EXTENDED vs EXHAUSTED (alpha-identity.ts)
  Q9 used "EXTENDED" for the > 1.5x ATR hard block. The intelligence block used
  "EXHAUSTED" for the same condition. Now unified: EXHAUSTED is canonical (matches
  JSON field values starting/developing/exhausted). EXTENDED preserved as synonym
  in parentheses for backward compatibility with legacy data.

  ### 2. Fallback Scalp Momentum Block (coordinator-alpha.ts)
  When no session intelligence snapshot exists, a "SCALP MOMENTUM SELF-ASSESSMENT"
  block is now injected for SCALP style. Ensures ATR phase governance and mandatory
  JSON fields are enforced regardless of intelligence pipeline state.

  ### 3. max_tokens Increase 700 -> 900 (coordinator-alpha.ts)
  Scalp JSON requires 4 extra fields vs other styles. 700 tokens regularly caused
  truncated responses and silent JSON parse failures producing NO_TRADE fallbacks.

  ## SSOT Compliance
  - alpha-identity.ts is SSOT for Alpha system prompt content
  - coordinator-alpha.ts is SSOT for user prompt construction
  - No database schema changes required
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
  '{"max_tokens": 700, "exhausted_label": "EXTENDED", "fallback_momentum_block": false}',
  '{"max_tokens": 900, "exhausted_label": "EXHAUSTED (EXTENDED synonym)", "fallback_momentum_block": true}',
  'CCIP-2026-02-19: Scalp prompt fixes — terminology unification, fallback momentum block, token budget 700->900',
  '{"ccip_id": "CCIP-2026-02-19-SCALP-PROMPT", "files": ["src/config/alpha-identity.ts", "src/brains/coordinator-alpha.ts"], "breaking": false}',
  now()
);
