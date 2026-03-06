/*
  # Fix Thesis Cache Hash Mismatch — SSOT Alignment + Stale Cache Purge

  ## Problem
  The thesis cache was permanently broken because the hash stored at write-time
  and the hash computed at validation-time used different field sets:

  ### createImmutableThesis (write side) included:
    - symbol, timeframe, directionBias, narrative, regime
    - liquidityContext, invalidationLogic, confidenceBand, thesisSummary
    - regimeSignature (full object including .symbol field)

  ### normalizeThesisForHashing (validation side) was missing:
    - timeframe (omitted entirely at top level)
    - regimeSignature.symbol (stripped out of regimeSignature)
    - liquidityContext/invalidationLogic coerced to '' instead of undefined

  Result: stored hash and validation hash NEVER matched — every scan called
  the Alpha LLM fresh for every symbol, ignoring valid 2-minute-old theses.

  ## Fix Applied (TypeScript)
  normalizeThesisForHashing in thesis-immutability-guard.ts now uses the
  identical field set as createImmutableThesis (SSOT alignment).

  ## Migration Action
  All existing alpha_market_thesis_cache rows were hashed with the old
  (broken) formula. They will always fail integrity checks with the new
  correct formula. This migration purges all stale entries so the cache
  starts clean — next scan cycle rebuilds with correct unified hashes.

  ## Tables Modified
  - alpha_market_thesis_cache: all rows deleted (stale, wrong-formula hashes)
  - governance_change_log: CCIP audit entry (operation: ccip_migration_applied)
*/

-- Purge all stale thesis cache entries that were hashed with the broken formula.
-- Self-healing: next scan cycle repopulates with correct unified hashes.
DELETE FROM alpha_market_thesis_cache;

-- CCIP audit trail: record the intentional purge.
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'thesis_immutability_guard',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"broken_function": "normalizeThesisForHashing", "missing_fields": ["timeframe", "regimeSignature.symbol"], "coercion_bug": "liquidityContext/invalidationLogic undefined->empty_string"}'::jsonb,
  '{"action": "purged_alpha_market_thesis_cache", "fix": "normalizeThesisForHashing aligned to createImmutableThesis", "expected_outcome": "cache HITs within TTL window after next scan"}'::jsonb,
  'CCIP SSOT fix: normalizeThesisForHashing missing timeframe + regimeSignature.symbol vs createImmutableThesis. Hashes never matched. Cache purged for clean rebuild.',
  '{"migration": "20260306_ccip_fix_thesis_hash_mismatch_cache_invalidation", "ssot_compliant": true, "ccip_compliant": true}'::jsonb
);
