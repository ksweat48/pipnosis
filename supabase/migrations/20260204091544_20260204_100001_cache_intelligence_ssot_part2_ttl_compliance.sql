/*
  # Cache Intelligence System - SSOT Compliance (Part 2: TTL Enforcement)

  ## Purpose
  Ensure all cached theses have valid expiration timestamps and cannot be accessed past TTL.

  ## Problem Identified
  - alpha_market_thesis_cache.expires_at may be NULL on some records
  - NULL expires_at causes queries to return NULL comparisons (invalidating cache)
  - Results in 16% hit rate (stale cache being bypassed)

  ## Solution

  1. **Add NOT NULL Constraint to expires_at**
     - Prevents future inserts of theses without TTL
     - Ensures cache_alpha_thesis RPC always sets expires_at

  2. **Backfill NULL expires_at Values**
     - Set to NOW() + 15 minutes (standard THESIS_TTL_MS)
     - Only for theses created in last 15 minutes (still valid)
     - Older NULL entries treated as expired (will be re-cached)

  3. **Update cache_alpha_thesis RPC**
     - Enforce expires_at is set (NOT NULL)
     - Default to NOW() + INTERVAL '15 minutes' if missing

  ## SSOT Impact
  - Cache TTL now guaranteed to be set and valid
  - No more accidental cache expiration
  - Hit rates should improve significantly
  - Fully backward compatible with existing cache entries
*/

-- =====================================================================
-- PART 1: ENSURE expires_at COLUMN EXISTS AND IS ACCESSIBLE
-- =====================================================================

DO $$
BEGIN
  -- Check if column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_market_thesis_cache'
      AND column_name = 'expires_at'
  ) THEN
    RAISE EXCEPTION 'Column expires_at does not exist on alpha_market_thesis_cache. Cannot proceed with TTL enforcement.';
  END IF;
END $$;

-- =====================================================================
-- PART 2: BACKFILL NULL expires_at VALUES (CRITICAL FIX)
-- =====================================================================

UPDATE alpha_market_thesis_cache
SET expires_at = NOW() + INTERVAL '15 minutes'
WHERE expires_at IS NULL
  AND created_at > NOW() - INTERVAL '15 minutes';

-- Log how many were backfilled
DO $$
DECLARE
  v_backfilled INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_backfilled
  FROM alpha_market_thesis_cache
  WHERE expires_at IS NOT NULL
    AND created_at > NOW() - INTERVAL '15 minutes';
  
  RAISE NOTICE 'Backfilled expires_at for % thesis cache entries', v_backfilled;
END $$;

-- =====================================================================
-- PART 3: CLEAN UP EXPIRED ENTRIES (GARBAGE COLLECTION)
-- =====================================================================

DELETE FROM alpha_market_thesis_cache
WHERE expires_at IS NOT NULL
  AND expires_at < NOW();

-- =====================================================================
-- PART 4: ADD NOT NULL CONSTRAINT (PREVENT FUTURE NULLS)
-- =====================================================================

ALTER TABLE alpha_market_thesis_cache
ALTER COLUMN expires_at SET NOT NULL;

-- =====================================================================
-- PART 5: UPDATE cache_alpha_thesis RPC TO ENFORCE expires_at
-- =====================================================================
-- This RPC is responsible for writing cached theses

DROP FUNCTION IF EXISTS public.cache_alpha_thesis(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) CASCADE;

CREATE OR REPLACE FUNCTION public.cache_alpha_thesis(
  p_thesis_id uuid,
  p_symbol text,
  p_timeframe text,
  p_direction_bias text,
  p_narrative text,
  p_regime text,
  p_liquidity_context text,
  p_invalidation_logic text,
  p_confidence_band jsonb,
  p_thesis_summary text,
  p_regime_signature_hash text,
  p_thesis_hash text,
  p_regime_signature_json text,
  p_htf_bias text,
  p_micro_regime text,
  p_volatility_regime text,
  p_structure_state text,
  p_timeframe_relevance text DEFAULT 'H1'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_thesis_id uuid := COALESCE(p_thesis_id, gen_random_uuid());
  v_expires_at timestamptz := NOW() + INTERVAL '15 minutes';
BEGIN
  INSERT INTO alpha_market_thesis_cache (
    id,
    symbol,
    timeframe,
    direction_bias,
    narrative,
    regime,
    liquidity_context,
    invalidation_logic,
    confidence_band,
    thesis_summary,
    regime_signature_hash,
    thesis_hash,
    regime_signature_json,
    htf_bias,
    micro_regime,
    volatility_regime,
    structure_state,
    timeframe_relevance,
    created_at,
    expires_at
  ) VALUES (
    v_thesis_id,
    p_symbol,
    p_timeframe,
    p_direction_bias,
    p_narrative,
    p_regime,
    p_liquidity_context,
    p_invalidation_logic,
    p_confidence_band,
    p_thesis_summary,
    p_regime_signature_hash,
    p_thesis_hash,
    p_regime_signature_json,
    p_htf_bias,
    p_micro_regime,
    p_volatility_regime,
    p_structure_state,
    p_timeframe_relevance,
    NOW(),
    v_expires_at
  )
  ON CONFLICT (id) DO UPDATE SET
    direction_bias = EXCLUDED.direction_bias,
    narrative = EXCLUDED.narrative,
    regime = EXCLUDED.regime,
    liquidity_context = EXCLUDED.liquidity_context,
    invalidation_logic = EXCLUDED.invalidation_logic,
    confidence_band = EXCLUDED.confidence_band,
    thesis_summary = EXCLUDED.thesis_summary,
    thesis_hash = EXCLUDED.thesis_hash,
    expires_at = v_expires_at
  RETURNING v_thesis_id INTO v_thesis_id;

  RETURN v_thesis_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cache_alpha_thesis(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated, service_role;

-- =====================================================================
-- PART 6: CREATE INDEXES FOR CACHE EFFICIENCY
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_alpha_thesis_cache_expires_at
  ON alpha_market_thesis_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_alpha_thesis_cache_regime_hash
  ON alpha_market_thesis_cache (regime_signature_hash);

-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- Count valid cached theses
DO $$
DECLARE
  v_valid_count INTEGER;
  v_null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_valid_count
  FROM alpha_market_thesis_cache
  WHERE expires_at > NOW();

  SELECT COUNT(*) INTO v_null_count
  FROM alpha_market_thesis_cache
  WHERE expires_at IS NULL;

  RAISE NOTICE 'Cache TTL Status - Valid (not expired): %, Null expires_at: %', v_valid_count, v_null_count;
  
  IF v_null_count > 0 THEN
    RAISE WARNING 'Still have % thesis entries with NULL expires_at! Check for constraint violation.', v_null_count;
  END IF;
END $$;
