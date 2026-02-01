/*
  # Fix cache_alpha_thesis RPC Signature - CCIP Governance Compliant

  ## Summary
  The cache_alpha_thesis function is receiving parameter p_regime_signature_json 
  from frontend but the function signature doesn't accept it, causing 400 Bad Request errors.

  ## Root Cause
  - Frontend: src/services/shared-intelligence-coordinator.ts line 290 passes p_regime_signature_json
  - Backend: cache_alpha_thesis function doesn't define this parameter
  - Supabase throws 400 Bad Request when extra parameters are passed

  ## CCIP Compliance
  - Change Type: RPC Function Signature Update (Governance-tracked)
  - Authority: Single source - database function definition
  - Impact: Fixes 400 errors when caching Alpha thesis
  - Compatibility: Backward compatible (added optional parameter)

  ## Solution
  Drop all cache_alpha_thesis overloads and recreate with updated signature.
*/

-- Drop existing function overloads
DROP FUNCTION IF EXISTS cache_alpha_thesis(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Create cache_alpha_thesis with updated signature that accepts p_regime_signature_json
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
  p_thesis_hash TEXT,
  p_regime_signature_json JSONB DEFAULT NULL
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
  -- Note: p_regime_signature_json is accepted but not stored (metadata parameter)
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

-- Re-grant permissions after function update
GRANT EXECUTE ON FUNCTION cache_alpha_thesis(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION cache_alpha_thesis(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
