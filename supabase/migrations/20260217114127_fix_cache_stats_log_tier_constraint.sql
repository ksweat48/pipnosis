/*
  # Fix cache_stats_log cache_tier constraint

  1. Problem
    - The `valid_cache_tier` constraint only allows legacy values: omega, alpha, scout, etc.
    - Frontend code sends `alpha_thesis` and `snapshot`, causing 400 errors on every insert.

  2. Fix
    - Drop the old constraint
    - Add a new constraint that includes both legacy and current values

  3. Security
    - No RLS changes needed (table already has RLS enabled)
*/

ALTER TABLE cache_stats_log DROP CONSTRAINT IF EXISTS valid_cache_tier;

ALTER TABLE cache_stats_log ADD CONSTRAINT valid_cache_tier 
  CHECK (cache_tier = ANY (ARRAY[
    'omega'::text, 
    'alpha'::text, 
    'scout'::text, 
    'market_context'::text, 
    'hybrid_orderflow'::text, 
    'freshness_gate'::text, 
    'shared_intelligence'::text,
    'alpha_thesis'::text,
    'snapshot'::text
  ]));