/*
  # CCIP-CACHE-HASH-FIX-2026-03-08: Clear Corrupted Alpha Thesis Cache

  ## Summary
  Purges all cached alpha theses that were stored with a corrupted hash.

  ## Root Cause
  The `normalizeThesisForHashing()` function coerced `regimeSignature` with
  `?? null`, producing `"regimeSignature":null` in the serialised hash input.
  However, `createImmutableThesis()` passed the raw value — when
  `regimeSignature` was `undefined`, `stableStringify` called
  `JSON.stringify(undefined)` which returns JS `undefined` (not the string
  "undefined"), causing that key to be DROPPED from the serialised object.

  The two serialisations were structurally different for every thesis whose
  `regimeSignature` was undefined, guaranteeing a permanent hash mismatch on
  every retrieval and forcing a full LLM regeneration on every scan cycle.

  ## Changes
  1. Clears all rows from `alpha_market_thesis_cache` — these were hashed with
     the broken algorithm and will fail the corrected integrity check.
     Fresh theses will be regenerated on the next scan cycle.

  2. Clears matching analytics rows from `cache_write_events` (tier = alpha_thesis)
     and `cache_stats_log` (tier = alpha_thesis) to avoid stale cache analytics.

  ## Security
  - No RLS changes required (admin/service-role cache management operation)
  - No user data affected — thesis cache is purely market analysis

  ## Notes
  - Theses regenerate automatically on next scan
  - The hash-algorithm fix is deployed simultaneously in the frontend build
  - `FRESH_SKIP_HASH_SECONDS` raised from 60 → 120 as additional safety margin
*/

DELETE FROM alpha_market_thesis_cache;

DELETE FROM cache_write_events
WHERE cache_tier = 'alpha_thesis';

DELETE FROM cache_stats_log
WHERE cache_tier = 'alpha_thesis';
