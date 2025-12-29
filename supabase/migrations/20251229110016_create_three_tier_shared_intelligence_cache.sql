/*
  # Three-Tier Shared Intelligence Cache System
  
  ## Purpose
  Implement a platform-wide LLM intelligence caching system that allows
  multiple users to share market analysis, dramatically reducing LLM costs
  and improving response times.
  
  ## Architecture
  - Tier 1: Global Market Intelligence (omega_market_intelligence)
    - Fully cacheable Omega brain outputs
    - Serves ALL users platform-wide
    - TTL: 15-20 minutes
  
  - Tier 2: Strategic Reasoning (alpha_strategic_cache)
    - Semi-cacheable Alpha strategy outputs
    - Market-level reasoning without user-specific goals
    - TTL: 10 minutes
  
  - Tier 3: Scout Global State (scout_market_state)
    - Global market scanning state
    - Runs once per symbol/timeframe, serves all users
    - TTL: 60 seconds
  
  ## New Tables
  1. omega_market_intelligence
     - Stores all Omega brain outputs with ATR-relative cache keys
     - Unique per (symbol, timeframe, brain_name, market_state_hash)
  
  2. alpha_strategic_cache
     - Stores strategic Alpha reasoning (direction, conviction, R:R range)
     - Unique per (symbol, timeframe, omega_votes_hash)
  
  3. scout_market_state
     - Stores global Scout analysis
     - Unique per (symbol, timeframe)
  
  4. cache_stats_log
     - Tracks cache performance metrics
  
  ## Security
  - All tables use RLS
  - Read access for authenticated users
  - Write access only for service role (background jobs)
*/

-- =====================================================
-- Tier 1: Omega Market Intelligence Cache
-- =====================================================
CREATE TABLE IF NOT EXISTS omega_market_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  brain_name text NOT NULL,
  atr_price_bucket integer NOT NULL,
  market_state_hash text NOT NULL,
  vote text NOT NULL,
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  reasoning text,
  key_factors jsonb DEFAULT '[]'::jsonb,
  raw_snapshot jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  
  CONSTRAINT valid_brain_name CHECK (brain_name IN (
    'trend', 'scalper', 'confirmation', 'reversal', 
    'volatility', 'risk', 'orderflow', 'sentiment',
    'hallucination', 'meta_reasoning', 'regime_oracle',
    'adversarial_detector'
  )),
  CONSTRAINT valid_vote CHECK (vote IN ('BUY', 'SELL', 'NO_TRADE', 'WAIT', 'NEUTRAL'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omega_cache_lookup 
ON omega_market_intelligence(symbol, timeframe, brain_name, market_state_hash);

CREATE INDEX IF NOT EXISTS idx_omega_cache_expiry 
ON omega_market_intelligence(expires_at);

CREATE INDEX IF NOT EXISTS idx_omega_cache_symbol_timeframe 
ON omega_market_intelligence(symbol, timeframe);

ALTER TABLE omega_market_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read omega intelligence"
  ON omega_market_intelligence FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage omega intelligence"
  ON omega_market_intelligence FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Tier 2: Alpha Strategic Cache
-- =====================================================
CREATE TABLE IF NOT EXISTS alpha_strategic_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  omega_votes_hash text NOT NULL,
  market_bias text NOT NULL,
  conviction integer NOT NULL CHECK (conviction >= 0 AND conviction <= 100),
  suggested_direction text NOT NULL,
  rr_range_min numeric(4,2),
  rr_range_max numeric(4,2),
  wait_recommended boolean DEFAULT false,
  key_reasoning text,
  full_reasoning text,
  omega_summary jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  
  CONSTRAINT valid_market_bias CHECK (market_bias IN ('bullish', 'bearish', 'neutral', 'mixed')),
  CONSTRAINT valid_suggested_direction CHECK (suggested_direction IN ('buy', 'sell', 'wait', 'no_trade'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alpha_cache_lookup 
ON alpha_strategic_cache(symbol, timeframe, omega_votes_hash);

CREATE INDEX IF NOT EXISTS idx_alpha_cache_expiry 
ON alpha_strategic_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_alpha_cache_symbol_timeframe 
ON alpha_strategic_cache(symbol, timeframe);

ALTER TABLE alpha_strategic_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read alpha strategic cache"
  ON alpha_strategic_cache FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage alpha strategic cache"
  ON alpha_strategic_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Tier 3: Scout Global Market State
-- =====================================================
CREATE TABLE IF NOT EXISTS scout_market_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  improvement_score integer DEFAULT 0,
  should_reconvene boolean DEFAULT false,
  key_changes text[] DEFAULT '{}',
  market_summary text,
  snapshot_hash text,
  price_at_scan numeric(20,8),
  volatility_state text,
  trend_state text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  
  CONSTRAINT valid_volatility_state CHECK (volatility_state IS NULL OR volatility_state IN ('low', 'medium', 'high', 'extreme')),
  CONSTRAINT valid_trend_state CHECK (trend_state IS NULL OR trend_state IN ('strong_bull', 'bull', 'sideways', 'bear', 'strong_bear'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scout_state_lookup 
ON scout_market_state(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_scout_state_expiry 
ON scout_market_state(expires_at);

ALTER TABLE scout_market_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read scout market state"
  ON scout_market_state FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage scout market state"
  ON scout_market_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Cache Statistics Log
-- =====================================================
CREATE TABLE IF NOT EXISTS cache_stats_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_tier text NOT NULL,
  symbol text,
  timeframe text,
  event_type text NOT NULL,
  hit_or_miss text,
  cache_age_seconds integer,
  llm_calls_saved integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  
  CONSTRAINT valid_cache_tier CHECK (cache_tier IN ('omega', 'alpha', 'scout')),
  CONSTRAINT valid_event_type CHECK (event_type IN ('lookup', 'write', 'expire', 'warm')),
  CONSTRAINT valid_hit_or_miss CHECK (hit_or_miss IS NULL OR hit_or_miss IN ('hit', 'miss'))
);

CREATE INDEX IF NOT EXISTS idx_cache_stats_created 
ON cache_stats_log(created_at);

CREATE INDEX IF NOT EXISTS idx_cache_stats_tier 
ON cache_stats_log(cache_tier, created_at);

ALTER TABLE cache_stats_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cache stats"
  ON cache_stats_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage cache stats"
  ON cache_stats_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function to get cache statistics
CREATE OR REPLACE FUNCTION get_cache_stats(
  p_hours integer DEFAULT 24
)
RETURNS TABLE (
  cache_tier text,
  total_lookups bigint,
  cache_hits bigint,
  cache_misses bigint,
  hit_rate numeric,
  avg_cache_age_seconds numeric,
  total_llm_calls_saved bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    csl.cache_tier,
    COUNT(*) FILTER (WHERE csl.event_type = 'lookup') as total_lookups,
    COUNT(*) FILTER (WHERE csl.event_type = 'lookup' AND csl.hit_or_miss = 'hit') as cache_hits,
    COUNT(*) FILTER (WHERE csl.event_type = 'lookup' AND csl.hit_or_miss = 'miss') as cache_misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE csl.event_type = 'lookup') > 0 
      THEN ROUND(
        (COUNT(*) FILTER (WHERE csl.event_type = 'lookup' AND csl.hit_or_miss = 'hit')::numeric / 
         COUNT(*) FILTER (WHERE csl.event_type = 'lookup')::numeric) * 100, 2
      )
      ELSE 0
    END as hit_rate,
    ROUND(AVG(csl.cache_age_seconds) FILTER (WHERE csl.hit_or_miss = 'hit'), 2) as avg_cache_age_seconds,
    COALESCE(SUM(csl.llm_calls_saved), 0) as total_llm_calls_saved
  FROM cache_stats_log csl
  WHERE csl.created_at > now() - (p_hours || ' hours')::interval
  GROUP BY csl.cache_tier
  ORDER BY csl.cache_tier;
END;
$$;

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS TABLE (
  omega_deleted bigint,
  alpha_deleted bigint,
  scout_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_omega_deleted bigint;
  v_alpha_deleted bigint;
  v_scout_deleted bigint;
BEGIN
  DELETE FROM omega_market_intelligence WHERE expires_at < now();
  GET DIAGNOSTICS v_omega_deleted = ROW_COUNT;
  
  DELETE FROM alpha_strategic_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_alpha_deleted = ROW_COUNT;
  
  DELETE FROM scout_market_state WHERE expires_at < now();
  GET DIAGNOSTICS v_scout_deleted = ROW_COUNT;
  
  DELETE FROM cache_stats_log WHERE created_at < now() - interval '7 days';
  
  RETURN QUERY SELECT v_omega_deleted, v_alpha_deleted, v_scout_deleted;
END;
$$;

-- Function to get fresh omega intelligence
CREATE OR REPLACE FUNCTION get_omega_intelligence(
  p_symbol text,
  p_timeframe text,
  p_brain_name text,
  p_market_state_hash text
)
RETURNS TABLE (
  id uuid,
  vote text,
  confidence integer,
  reasoning text,
  key_factors jsonb,
  created_at timestamptz,
  cache_age_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    omi.id,
    omi.vote,
    omi.confidence,
    omi.reasoning,
    omi.key_factors,
    omi.created_at,
    EXTRACT(EPOCH FROM (now() - omi.created_at))::integer as cache_age_seconds
  FROM omega_market_intelligence omi
  WHERE omi.symbol = p_symbol
    AND omi.timeframe = p_timeframe
    AND omi.brain_name = p_brain_name
    AND omi.market_state_hash = p_market_state_hash
    AND omi.expires_at > now()
  ORDER BY omi.created_at DESC
  LIMIT 1;
END;
$$;

-- Function to get fresh alpha strategic cache
CREATE OR REPLACE FUNCTION get_alpha_strategic(
  p_symbol text,
  p_timeframe text,
  p_omega_votes_hash text
)
RETURNS TABLE (
  id uuid,
  market_bias text,
  conviction integer,
  suggested_direction text,
  rr_range_min numeric,
  rr_range_max numeric,
  wait_recommended boolean,
  key_reasoning text,
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
    asc_t.id,
    asc_t.market_bias,
    asc_t.conviction,
    asc_t.suggested_direction,
    asc_t.rr_range_min,
    asc_t.rr_range_max,
    asc_t.wait_recommended,
    asc_t.key_reasoning,
    asc_t.omega_summary,
    asc_t.created_at,
    EXTRACT(EPOCH FROM (now() - asc_t.created_at))::integer as cache_age_seconds
  FROM alpha_strategic_cache asc_t
  WHERE asc_t.symbol = p_symbol
    AND asc_t.timeframe = p_timeframe
    AND asc_t.omega_votes_hash = p_omega_votes_hash
    AND asc_t.expires_at > now()
  ORDER BY asc_t.created_at DESC
  LIMIT 1;
END;
$$;

-- Function to get scout market state
CREATE OR REPLACE FUNCTION get_scout_state(
  p_symbol text,
  p_timeframe text
)
RETURNS TABLE (
  id uuid,
  improvement_score integer,
  should_reconvene boolean,
  key_changes text[],
  market_summary text,
  volatility_state text,
  trend_state text,
  price_at_scan numeric,
  created_at timestamptz,
  cache_age_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sms.id,
    sms.improvement_score,
    sms.should_reconvene,
    sms.key_changes,
    sms.market_summary,
    sms.volatility_state,
    sms.trend_state,
    sms.price_at_scan,
    sms.created_at,
    EXTRACT(EPOCH FROM (now() - sms.created_at))::integer as cache_age_seconds
  FROM scout_market_state sms
  WHERE sms.symbol = p_symbol
    AND sms.timeframe = p_timeframe
    AND sms.expires_at > now()
  ORDER BY sms.created_at DESC
  LIMIT 1;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_cache_stats TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_cache TO service_role;
GRANT EXECUTE ON FUNCTION get_omega_intelligence TO authenticated;
GRANT EXECUTE ON FUNCTION get_alpha_strategic TO authenticated;
GRANT EXECUTE ON FUNCTION get_scout_state TO authenticated;
