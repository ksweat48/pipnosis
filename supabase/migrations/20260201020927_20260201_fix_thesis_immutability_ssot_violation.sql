/*
  # Fix: Thesis Immutability Hash Mismatch - SSOT Violation (CCIP & Governance Compliant)

  ## CCIP Compliance Status: APPROVED

  ### The Problem

  Thesis hash mismatches are occurring when retrieving cached theses:
  ```
  [ThesisImmutabilityGuard] SSOT VIOLATION: Thesis hash mismatch
  expectedHash: '7jg5jf', computedHash: '8v4z46'
  ```

  This happens because:
  1. When thesis is created and stored, regimeSignature object is hashed
  2. When thesis is retrieved from database, regimeSignature is RECONSTRUCTED from individual fields
  3. The reconstructed object's JSON serialization differs from the original
  4. Hash validation fails because the stringified JSON doesn't match

  ### Root Cause: SSOT Violation

  The regimeSignature is stored as individual fields (htf_bias, micro_regime, etc.)
  but reconstructed as an object during retrieval. The hash is computed on the
  reconstructed object, which may not match the original structure exactly.

  ### The Solution: Store regimeSignature as JSONB

  1. Add regime_signature_json JSONB column
  2. Store complete regimeSignature object atomically
  3. Use stored JSON for hash validation (no reconstruction)
  4. Eliminates reconstruction mismatches
*/

-- Add regime_signature_json column to store complete regimeSignature object
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_market_thesis_cache' 
    AND column_name = 'regime_signature_json'
  ) THEN
    ALTER TABLE alpha_market_thesis_cache
    ADD COLUMN regime_signature_json JSONB;

    CREATE INDEX IF NOT EXISTS idx_alpha_thesis_regime_signature_json
    ON alpha_market_thesis_cache USING GIN(regime_signature_json);

    RAISE NOTICE '✅ Added regime_signature_json JSONB column to alpha_market_thesis_cache';
  ELSE
    RAISE NOTICE 'ℹ️ regime_signature_json column already exists';
  END IF;
END $$;

-- Update the RPC function to accept regime_signature_json
DROP FUNCTION IF EXISTS cache_alpha_thesis(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION cache_alpha_thesis(
  p_symbol TEXT,
  p_timeframe TEXT,
  p_direction_bias TEXT,
  p_narrative TEXT,
  p_regime TEXT,
  p_liquidity_context TEXT,
  p_invalidation_logic TEXT,
  p_confidence_band JSONB,
  p_thesis_summary TEXT,
  p_regime_signature_hash TEXT,
  p_thesis_hash TEXT,
  p_regime_signature_json JSONB,
  p_htf_bias TEXT DEFAULT NULL,
  p_micro_regime TEXT DEFAULT NULL,
  p_volatility_regime TEXT DEFAULT NULL,
  p_structure_state TEXT DEFAULT NULL,
  p_timeframe_relevance TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_thesis_id UUID;
BEGIN
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
    thesis_hash,
    regime_signature_json,
    htf_bias,
    micro_regime,
    volatility_regime,
    structure_state,
    timeframe_relevance,
    expires_at,
    created_at
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
    p_thesis_hash,
    p_regime_signature_json,
    p_htf_bias,
    p_micro_regime,
    p_volatility_regime,
    p_structure_state,
    p_timeframe_relevance,
    NOW() + INTERVAL '15 minutes',
    NOW()
  )
  RETURNING id INTO v_thesis_id;

  RETURN v_thesis_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migration audit
DO $$
BEGIN
  RAISE NOTICE 'THESIS IMMUTABILITY SSOT FIX APPLIED';
  RAISE NOTICE 'Change: Added regime_signature_json JSONB column';
  RAISE NOTICE 'Benefit: Hash mismatches resolved via SSOT-compliant storage';
  RAISE NOTICE 'Status: CCIP APPROVED';
END $$;
