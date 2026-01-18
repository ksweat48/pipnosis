/*
  # Alpha Thesis Cache - Regime-Based Architecture

  ## Summary
  Refactors Alpha market thesis caching from Omega-vote-based to regime-signature-based.
  Implements clean separation between thesis (market truth) and execution (user-specific decisions).

  ## Changes

  ### 1. Regime-Based Thesis Cache
  - Updates `alpha_market_thesis_cache` table schema
  - Adds regime signature columns: `htf_bias`, `micro_regime`, `volatility_regime`, `structure_state`
  - Adds `thesis_hash` for immutability verification
  - Removes `omega_votes_hash` (no longer needed)
  - Sets fixed 15-minute TTL via `expires_at`

  ### 2. Thesis Rejection Learning
  - Creates `alpha_thesis_rejections` table for learning signals
  - Logs when Alpha rejects cached thesis (high-value signal)
  - Tracks rejection reasons, regime state, and timing
  - Enables offline analysis for thesis quality improvement

  ### 3. Indexes & Performance
  - Composite index on `(symbol, regime_signature_hash)` for fast lookups
  - Index on `rejected_at` for analytics queries
  - TTL-based auto-cleanup via `expires_at`

  ### 4. RLS Policies
  - Service role access for cache management
  - Authenticated user read access for thesis retrieval
  - Service role write access for rejection logging

  ## SSOT Principles
  - Thesis = market truth (cacheable across users)
  - Execution = user-specific (never cached)
  - Session context EXCLUDED from cache key (execution-only)
  - 15-minute TTL + structure-aware invalidation
*/

-- Update alpha_market_thesis_cache table for regime-based caching
DO $$
BEGIN
  -- Add regime signature columns if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_market_thesis_cache' AND column_name = 'regime_signature_hash'
  ) THEN
    ALTER TABLE alpha_market_thesis_cache
    ADD COLUMN regime_signature_hash TEXT,
    ADD COLUMN htf_bias TEXT,
    ADD COLUMN micro_regime TEXT,
    ADD COLUMN volatility_regime TEXT,
    ADD COLUMN structure_state TEXT,
    ADD COLUMN thesis_hash TEXT,
    ADD COLUMN timeframe_relevance TEXT;
  END IF;

  -- Drop omega_votes_hash column if it exists (no longer needed)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_market_thesis_cache' AND column_name = 'omega_votes_hash'
  ) THEN
    ALTER TABLE alpha_market_thesis_cache DROP COLUMN IF EXISTS omega_votes_hash;
  END IF;
END $$;

-- Create composite index for fast regime-based lookups (without WHERE clause)
CREATE INDEX IF NOT EXISTS idx_alpha_thesis_regime_lookup
ON alpha_market_thesis_cache(symbol, regime_signature_hash, expires_at DESC);

-- Create index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_alpha_thesis_expires
ON alpha_market_thesis_cache(expires_at DESC);

-- Create alpha_thesis_rejections table for learning signals
CREATE TABLE IF NOT EXISTS alpha_thesis_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  current_regime_snapshot JSONB NOT NULL,
  time_since_thesis_ms INTEGER NOT NULL,
  execution_style TEXT NOT NULL,
  session_context TEXT NOT NULL,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for rejection analytics
CREATE INDEX IF NOT EXISTS idx_thesis_rejections_symbol
ON alpha_thesis_rejections(symbol, rejected_at DESC);

CREATE INDEX IF NOT EXISTS idx_thesis_rejections_time
ON alpha_thesis_rejections(rejected_at DESC);

-- Enable RLS on tables
ALTER TABLE alpha_market_thesis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_thesis_rejections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Service role full access to thesis cache" ON alpha_market_thesis_cache;
DROP POLICY IF EXISTS "Authenticated users can read thesis cache" ON alpha_market_thesis_cache;
DROP POLICY IF EXISTS "Service role can log rejections" ON alpha_thesis_rejections;
DROP POLICY IF EXISTS "Service role can read rejections" ON alpha_thesis_rejections;

-- RLS Policies for alpha_market_thesis_cache

-- Service role can read/write thesis cache
CREATE POLICY "Service role full access to thesis cache"
ON alpha_market_thesis_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Authenticated users can read thesis cache (for cache hits)
CREATE POLICY "Authenticated users can read thesis cache"
ON alpha_market_thesis_cache
FOR SELECT
TO authenticated
USING (expires_at > NOW());

-- RLS Policies for alpha_thesis_rejections

-- Service role can write rejections
CREATE POLICY "Service role can log rejections"
ON alpha_thesis_rejections
FOR INSERT
TO service_role
WITH CHECK (true);

-- Service role can read rejections (for analytics)
CREATE POLICY "Service role can read rejections"
ON alpha_thesis_rejections
FOR SELECT
TO service_role
USING (true);

-- Create RPC function to get thesis by regime signature
CREATE OR REPLACE FUNCTION get_alpha_thesis_by_regime(
  p_symbol TEXT,
  p_regime_hash TEXT
)
RETURNS TABLE (
  id UUID,
  symbol TEXT,
  timeframe TEXT,
  direction_bias TEXT,
  narrative TEXT,
  regime TEXT,
  liquidity_context TEXT,
  invalidation_logic TEXT,
  confidence_band TEXT,
  thesis_summary TEXT,
  regime_signature_hash TEXT,
  htf_bias TEXT,
  micro_regime TEXT,
  volatility_regime TEXT,
  structure_state TEXT,
  timeframe_relevance TEXT,
  thesis_hash TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
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
    t.htf_bias,
    t.micro_regime,
    t.volatility_regime,
    t.structure_state,
    t.timeframe_relevance,
    t.thesis_hash,
    t.created_at,
    t.expires_at
  FROM alpha_market_thesis_cache t
  WHERE t.symbol = p_symbol
    AND t.regime_signature_hash = p_regime_hash
    AND t.expires_at > NOW()
  ORDER BY t.created_at DESC
  LIMIT 1;
END;
$$;

-- Create RPC function to invalidate thesis by structure change
CREATE OR REPLACE FUNCTION invalidate_thesis_by_structure(
  p_symbol TEXT,
  p_regime_hash TEXT
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Mark thesis as expired (structure changed)
  UPDATE alpha_market_thesis_cache
  SET expires_at = NOW()
  WHERE symbol = p_symbol
    AND regime_signature_hash = p_regime_hash
    AND expires_at > NOW();
END;
$$;

-- Create RPC function to cache new thesis
CREATE OR REPLACE FUNCTION cache_alpha_thesis(
  p_symbol TEXT,
  p_timeframe TEXT,
  p_direction_bias TEXT,
  p_narrative TEXT,
  p_regime TEXT,
  p_liquidity_context TEXT,
  p_invalidation_logic TEXT,
  p_confidence_band TEXT,
  p_thesis_summary TEXT,
  p_regime_signature_hash TEXT,
  p_htf_bias TEXT,
  p_micro_regime TEXT,
  p_volatility_regime TEXT,
  p_structure_state TEXT,
  p_timeframe_relevance TEXT,
  p_thesis_hash TEXT
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_thesis_id UUID;
BEGIN
  -- Insert new thesis with 15-minute TTL
  INSERT INTO alpha_market_thesis_cache (
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
    htf_bias,
    micro_regime,
    volatility_regime,
    structure_state,
    timeframe_relevance,
    thesis_hash,
    expires_at
  ) VALUES (
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
    p_htf_bias,
    p_micro_regime,
    p_volatility_regime,
    p_structure_state,
    p_timeframe_relevance,
    p_thesis_hash,
    NOW() + INTERVAL '15 minutes'
  )
  RETURNING id INTO v_thesis_id;

  RETURN v_thesis_id;
END;
$$;

-- Create RPC function to log thesis rejection
CREATE OR REPLACE FUNCTION log_thesis_rejection(
  p_thesis_id TEXT,
  p_symbol TEXT,
  p_rejection_reason TEXT,
  p_current_regime_snapshot JSONB,
  p_time_since_thesis_ms INTEGER,
  p_execution_style TEXT,
  p_session_context TEXT
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_rejection_id UUID;
BEGIN
  INSERT INTO alpha_thesis_rejections (
    thesis_id,
    symbol,
    rejection_reason,
    current_regime_snapshot,
    time_since_thesis_ms,
    execution_style,
    session_context,
    rejected_at
  ) VALUES (
    p_thesis_id,
    p_symbol,
    p_rejection_reason,
    p_current_regime_snapshot,
    p_time_since_thesis_ms,
    p_execution_style,
    p_session_context,
    NOW()
  )
  RETURNING id INTO v_rejection_id;

  RETURN v_rejection_id;
END;
$$;

-- Create cleanup function for expired theses
CREATE OR REPLACE FUNCTION cleanup_expired_theses()
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete theses older than 24 hours (well past 15-minute TTL)
  DELETE FROM alpha_market_thesis_cache
  WHERE expires_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN v_deleted_count;
END;
$$;

-- Grant execute permissions to service role
GRANT EXECUTE ON FUNCTION get_alpha_thesis_by_regime TO service_role;
GRANT EXECUTE ON FUNCTION invalidate_thesis_by_structure TO service_role;
GRANT EXECUTE ON FUNCTION cache_alpha_thesis TO service_role;
GRANT EXECUTE ON FUNCTION log_thesis_rejection TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_theses TO service_role;

-- Grant execute permissions to authenticated users (for cache lookups)
GRANT EXECUTE ON FUNCTION get_alpha_thesis_by_regime TO authenticated;