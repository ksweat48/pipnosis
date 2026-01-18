/*
  # Transform 3-Tier Cache to Alpha Market Thesis Cache

  ## Purpose
  Simplify caching architecture to cache ONLY Alpha's market thesis (expensive LLM analysis),
  not execution decisions. This preserves user-specific execution while reducing LLM costs by 60-85%.

  ## Architectural Principle
  - Cache Alpha's MARKET THESIS (what's happening in the market)
  - Do NOT cache execution decisions (how to trade it per user)
  - Omega votes are deterministic (instant computation, no caching needed)
  - Scout was removed (SSOT snapshot caching provides same benefits)

  ## Migration Safety
  - Uses IF EXISTS to prevent errors
  - Updates constraints before data migration
  - Handles existing data carefully
  - Maintains RLS policies throughout
*/

-- =====================================================
-- Step 1: Temporarily Relax Constraint for Migration
-- =====================================================

ALTER TABLE cache_stats_log
DROP CONSTRAINT IF EXISTS valid_cache_tier;

ALTER TABLE cache_stats_log
ADD CONSTRAINT valid_cache_tier CHECK (cache_tier IN ('omega', 'alpha', 'scout', 'alpha_thesis', 'snapshot'));

-- =====================================================
-- Step 2: Migrate Cache Stats Log Data
-- =====================================================

-- Migrate all omega/scout/alpha entries to alpha_thesis
UPDATE cache_stats_log
SET cache_tier = 'alpha_thesis'
WHERE cache_tier IN ('alpha', 'omega', 'scout');

-- =====================================================
-- Step 3: Update Constraint to Final Values
-- =====================================================

ALTER TABLE cache_stats_log
DROP CONSTRAINT valid_cache_tier;

ALTER TABLE cache_stats_log
ADD CONSTRAINT valid_cache_tier CHECK (cache_tier IN ('alpha_thesis', 'snapshot'));

-- =====================================================
-- Step 4: Drop Unused Cache Tables
-- =====================================================

-- Drop Omega cache (deterministic data should never be cached)
DROP TABLE IF EXISTS omega_market_intelligence CASCADE;

-- Drop Scout cache (Scout system eliminated, replaced by SSOT snapshot)
DROP TABLE IF EXISTS scout_market_state CASCADE;

-- =====================================================
-- Step 5: Transform Alpha Strategic Cache to Thesis Cache
-- =====================================================

-- Rename table
ALTER TABLE IF EXISTS alpha_strategic_cache
RENAME TO alpha_market_thesis_cache;

-- Add thesis-specific columns (nullable for migration safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_market_thesis_cache' AND column_name = 'direction_bias'
  ) THEN
    ALTER TABLE alpha_market_thesis_cache
    ADD COLUMN direction_bias text,
    ADD COLUMN narrative text,
    ADD COLUMN regime text,
    ADD COLUMN liquidity_context text,
    ADD COLUMN invalidation_logic text,
    ADD COLUMN confidence_band text;
  END IF;
END $$;

-- Update existing rows to populate new columns from old data
UPDATE alpha_market_thesis_cache
SET
  direction_bias = CASE
    WHEN market_bias = 'bullish' THEN 'BUY'
    WHEN market_bias = 'bearish' THEN 'SELL'
    ELSE 'NEUTRAL'
  END,
  narrative = COALESCE(full_reasoning, key_reasoning, 'Market analysis'),
  regime = COALESCE(market_bias, 'neutral'),
  liquidity_context = 'Standard liquidity conditions',
  invalidation_logic = 'Standard invalidation rules',
  confidence_band = CASE
    WHEN conviction >= 75 THEN 'strong'
    WHEN conviction >= 50 THEN 'medium'
    ELSE 'weak'
  END
WHERE direction_bias IS NULL;

-- Now make thesis columns NOT NULL
ALTER TABLE alpha_market_thesis_cache
ALTER COLUMN direction_bias SET NOT NULL,
ALTER COLUMN narrative SET NOT NULL,
ALTER COLUMN regime SET NOT NULL,
ALTER COLUMN confidence_band SET NOT NULL;

-- Remove execution-specific columns (these should never be cached)
ALTER TABLE alpha_market_thesis_cache
DROP COLUMN IF EXISTS suggested_direction,
DROP COLUMN IF EXISTS rr_range_min,
DROP COLUMN IF EXISTS rr_range_max,
DROP COLUMN IF EXISTS wait_recommended,
DROP COLUMN IF EXISTS market_bias,
DROP COLUMN IF EXISTS conviction;

-- Update constraints
ALTER TABLE alpha_market_thesis_cache
DROP CONSTRAINT IF EXISTS valid_market_bias,
DROP CONSTRAINT IF EXISTS valid_suggested_direction;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_direction_bias' AND conrelid = 'alpha_market_thesis_cache'::regclass
  ) THEN
    ALTER TABLE alpha_market_thesis_cache
    ADD CONSTRAINT valid_direction_bias CHECK (direction_bias IN ('BUY', 'SELL', 'NEUTRAL', 'MIXED'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_confidence_band' AND conrelid = 'alpha_market_thesis_cache'::regclass
  ) THEN
    ALTER TABLE alpha_market_thesis_cache
    ADD CONSTRAINT valid_confidence_band CHECK (confidence_band IN ('weak', 'medium', 'strong'));
  END IF;
END $$;

-- Rename key_reasoning to thesis_summary for clarity
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_market_thesis_cache' AND column_name = 'key_reasoning'
  ) THEN
    ALTER TABLE alpha_market_thesis_cache
    RENAME COLUMN key_reasoning TO thesis_summary;
  END IF;
END $$;

-- Update indexes
DROP INDEX IF EXISTS idx_alpha_cache_lookup;
DROP INDEX IF EXISTS idx_alpha_cache_expiry;
DROP INDEX IF EXISTS idx_alpha_cache_symbol_timeframe;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_thesis_lookup
ON alpha_market_thesis_cache(symbol, timeframe, omega_votes_hash);

CREATE INDEX IF NOT EXISTS idx_alpha_thesis_expiry
ON alpha_market_thesis_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_alpha_thesis_symbol_timeframe
ON alpha_market_thesis_cache(symbol, timeframe, created_at DESC);

-- =====================================================
-- Step 6: Update RLS Policies
-- =====================================================

DROP POLICY IF EXISTS "Authenticated users can read alpha strategic cache" ON alpha_market_thesis_cache;
DROP POLICY IF EXISTS "Service role can manage alpha strategic cache" ON alpha_market_thesis_cache;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alpha_market_thesis_cache' AND policyname = 'Authenticated users can read alpha thesis'
  ) THEN
    CREATE POLICY "Authenticated users can read alpha thesis"
      ON alpha_market_thesis_cache FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alpha_market_thesis_cache' AND policyname = 'Service role can manage alpha thesis'
  ) THEN
    CREATE POLICY "Service role can manage alpha thesis"
      ON alpha_market_thesis_cache FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- =====================================================
-- Step 7: Update Helper Functions
-- =====================================================

-- Drop old cleanup function with old signature
DROP FUNCTION IF EXISTS cleanup_expired_cache();

-- Create new thesis retrieval function
CREATE OR REPLACE FUNCTION get_alpha_thesis(
  p_symbol text,
  p_timeframe text,
  p_omega_votes_hash text
)
RETURNS TABLE (
  id uuid,
  direction_bias text,
  narrative text,
  regime text,
  liquidity_context text,
  invalidation_logic text,
  confidence_band text,
  thesis_summary text,
  omega_summary jsonb,
  created_at timestamptz,
  cache_age_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    amt.id,
    amt.direction_bias,
    amt.narrative,
    amt.regime,
    amt.liquidity_context,
    amt.invalidation_logic,
    amt.confidence_band,
    amt.thesis_summary,
    amt.omega_summary,
    amt.created_at,
    EXTRACT(EPOCH FROM (now() - amt.created_at))::integer as cache_age_seconds
  FROM alpha_market_thesis_cache amt
  WHERE amt.symbol = p_symbol
    AND amt.timeframe = p_timeframe
    AND amt.omega_votes_hash = p_omega_votes_hash
    AND amt.expires_at > now()
  ORDER BY amt.created_at DESC
  LIMIT 1;
END;
$$;

-- Create new cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS TABLE (
  alpha_thesis_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alpha_deleted bigint;
BEGIN
  DELETE FROM alpha_market_thesis_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_alpha_deleted = ROW_COUNT;

  DELETE FROM cache_stats_log WHERE created_at < now() - interval '7 days';

  RETURN QUERY SELECT v_alpha_deleted;
END;
$$;

-- =====================================================
-- Step 8: Grant Permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION get_alpha_thesis TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_cache TO service_role;

-- =====================================================
-- Step 9: Add Monitoring Comments
-- =====================================================

COMMENT ON TABLE alpha_market_thesis_cache IS
'Caches Alphas market thesis (expensive LLM analysis) for reuse across users. Does NOT cache execution decisions (SL/TP/risk) which remain user-specific. TTL: 3-15 minutes depending on timeframe.';

COMMENT ON COLUMN alpha_market_thesis_cache.direction_bias IS
'Market direction bias: BUY, SELL, NEUTRAL, MIXED - derived from expensive LLM analysis';

COMMENT ON COLUMN alpha_market_thesis_cache.narrative IS
'Alphas explanation of market structure, liquidity, and context - the expensive part we cache';

COMMENT ON COLUMN alpha_market_thesis_cache.omega_votes_hash IS
'Hash of Omega council votes - ensures thesis only reused when market conditions match';
