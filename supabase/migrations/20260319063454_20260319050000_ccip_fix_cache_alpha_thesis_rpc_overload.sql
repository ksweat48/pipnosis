/*
  # CCIP-CACHE-WRITE-FIX-2026-03-19: Drop duplicate cache_alpha_thesis RPC overload

  ## Summary
  Removes the stale `cache_alpha_thesis` overload that accepts `p_confidence_band` as
  `jsonb`. The canonical overload (introduced in migration 20260201024714) accepts
  `p_confidence_band` as `text`. The jsonb overload was an accidental duplicate that
  caused Supabase PostgREST to be unable to resolve the correct function, silently
  routing some calls to the wrong version or returning a 409/400 error.

  ## Root Cause
  The `coordinator-alpha.ts` cache write was broken in two independent ways:
    1. Re-entrant `getAlphaThesis()` call (fixed in CCIP-CACHE-WRITE-FIX-2026-03-19
       frontend changes — adds `cacheThesis()` direct-write method)
    2. This RPC overload ambiguity — if the re-entrant call had somehow succeeded, the
       jsonb/text mismatch would have caused the RPC to fail anyway

  ## Changes
  - DROP the duplicate `cache_alpha_thesis` overload whose `p_confidence_band` is typed as
    `jsonb`. The canonical `text` version is preserved unchanged.

  ## Affected Tables / Functions
  - `cache_alpha_thesis` (function — drops jsonb variant only)

  ## Security
  No table changes. No RLS changes. Function permissions unchanged.

  ## Important Notes
  - Safe to re-run: DROP IF EXISTS
  - The text-typed overload is the SSOT canonical version used by SharedIntelligenceCoordinator
  - PostgREST schema cache is reloaded via NOTIFY after the drop
*/

DROP FUNCTION IF EXISTS cache_alpha_thesis(
  text,  -- p_symbol
  text,  -- p_timeframe
  text,  -- p_direction_bias
  text,  -- p_narrative
  text,  -- p_regime
  text,  -- p_liquidity_context
  text,  -- p_invalidation_logic
  jsonb, -- p_confidence_band  ← the jsonb variant being removed
  text,  -- p_thesis_summary
  text,  -- p_regime_signature_hash
  text,  -- p_thesis_hash
  text,  -- p_regime_signature_json
  text,  -- p_htf_bias
  text,  -- p_micro_regime
  text,  -- p_volatility_regime
  text,  -- p_structure_state
  text   -- p_timeframe_relevance
);

NOTIFY pgrst, 'reload schema';
