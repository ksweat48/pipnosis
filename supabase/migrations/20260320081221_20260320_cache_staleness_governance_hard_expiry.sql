/*
  # Cache Staleness Governance — Hard Expiry Enforcement

  ## Summary
  Prevents Alpha from ever receiving expired thesis or intelligence data.

  ## Problem
  `alpha_market_thesis_cache` accumulated rows up to 5 days old (e.g. a NAS100
  SELL thesis from March 15 was still present on March 20). Although the primary
  read-path RPC (`get_alpha_thesis_by_regime`) filters by `expires_at > NOW()`,
  expired rows remained in the table indefinitely, creating risk of:
    1. Analytics queries misrepresenting system state with stale directional bias
    2. `thesis-cache-warmer.ts identifyActiveRegimes()` treating stale regime
       signatures as currently active (no expiry filter — now fixed in code)
    3. `cleanup_expired_cache` RPC had no guaranteed automatic invocation

  ## Changes
  1. Immediate cleanup of all expired rows in both caches
  2. Recreated `cleanup_expired_cache` RPC with DROP + CREATE
  3. Auto-cleanup trigger on INSERT to `alpha_market_thesis_cache`
  4. `enforce_thesis_cache_freshness` hard read-time guard RPC
  5. `cache_stats_log` already has correct structure — governance audit via INSERT

  ## CCIP: CCIP-CACHE-STALENESS-GOVERNANCE-2026-03-20
*/

-- ============================================================
-- 1. IMMEDIATE CLEANUP: Delete all expired rows
-- ============================================================

DELETE FROM alpha_market_thesis_cache WHERE expires_at <= NOW();
DELETE FROM alpha_intelligence_cache WHERE expires_at <= NOW();

-- ============================================================
-- 2. Recreate cleanup_expired_cache RPC (DROP first to allow return type change)
-- ============================================================

DROP FUNCTION IF EXISTS cleanup_expired_cache();

CREATE FUNCTION cleanup_expired_cache()
RETURNS TABLE (
  alpha_thesis_deleted integer,
  intelligence_deleted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thesis_deleted integer := 0;
  v_intel_deleted  integer := 0;
BEGIN
  DELETE FROM alpha_market_thesis_cache
  WHERE expires_at <= NOW();
  GET DIAGNOSTICS v_thesis_deleted = ROW_COUNT;

  DELETE FROM alpha_intelligence_cache
  WHERE expires_at <= NOW();
  GET DIAGNOSTICS v_intel_deleted = ROW_COUNT;

  IF v_thesis_deleted > 0 OR v_intel_deleted > 0 THEN
    INSERT INTO cache_stats_log (
      cache_tier,
      symbol,
      timeframe,
      event_type,
      hit_or_miss,
      cache_age_seconds,
      llm_calls_saved
    ) VALUES (
      'alpha_thesis',
      'ALL',
      'ALL',
      'expire',
      NULL,
      0,
      0
    );
  END IF;

  RETURN QUERY SELECT v_thesis_deleted, v_intel_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_cache() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_cache() TO service_role;

-- ============================================================
-- 3. Auto-cleanup trigger on INSERT to alpha_market_thesis_cache
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_cleanup_expired_thesis_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM alpha_market_thesis_cache
  WHERE expires_at <= NOW() - INTERVAL '1 hour';
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_cleanup_expired_thesis_on_insert ON alpha_market_thesis_cache;

CREATE TRIGGER auto_cleanup_expired_thesis_on_insert
  AFTER INSERT ON alpha_market_thesis_cache
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_cleanup_expired_thesis_cache();

-- ============================================================
-- 4. enforce_thesis_cache_freshness — hard read-time guard RPC
-- ============================================================

DROP FUNCTION IF EXISTS enforce_thesis_cache_freshness(text, text);

CREATE FUNCTION enforce_thesis_cache_freshness(
  p_symbol text,
  p_regime_hash text
)
RETURNS TABLE (
  id uuid,
  symbol text,
  timeframe text,
  direction_bias text,
  narrative text,
  regime text,
  liquidity_context text,
  invalidation_logic text,
  confidence_band text,
  thesis_summary text,
  regime_signature_hash text,
  thesis_hash text,
  htf_bias text,
  micro_regime text,
  volatility_regime text,
  structure_state text,
  timeframe_relevance text,
  regime_signature_json jsonb,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    t.id,
    t.symbol,
    t.timeframe,
    t.direction_bias,
    t.narrative,
    t.regime,
    t.liquidity_context,
    t.invalidation_logic,
    t.confidence_band,
    t.thesis_summary,
    t.regime_signature_hash,
    t.thesis_hash,
    t.htf_bias,
    t.micro_regime,
    t.volatility_regime,
    t.structure_state,
    t.timeframe_relevance,
    t.regime_signature_json,
    t.created_at,
    t.expires_at
  FROM alpha_market_thesis_cache t
  WHERE t.symbol = p_symbol
    AND t.regime_signature_hash = p_regime_hash
    AND t.expires_at > NOW()
  ORDER BY t.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION enforce_thesis_cache_freshness(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION enforce_thesis_cache_freshness(text, text) TO service_role;
