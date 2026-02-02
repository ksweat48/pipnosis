/*
  # Emergency Drop JSONB cache_alpha_thesis Overload - SSOT Enforcement

  1. Issue
    - Two versions of cache_alpha_thesis still exist (HTTP 300 Multiple Choices)
    - Version 1: All TEXT parameters (new, authoritative SSOT version)
    - Version 2: p_confidence_band JSONB, p_regime_signature_json JSONB (old, conflicting)

  2. Solution
    - Drop the conflicting JSONB version
    - Keep only TEXT version matching frontend RPC signature
    - Enforce SSOT single authority at function definition level

  3. CCIP Compliance
    - Final consolidation to eliminate routing ambiguity
    - Function definition = authoritative source of truth
    - No future overloads permitted
*/

-- Drop the JSONB parameter version (conflicting overload)
DROP FUNCTION IF EXISTS cache_alpha_thesis(
  text, text, text, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text, text, text
);

-- Verify only one version remains
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'cache_alpha_thesis' AND n.nspname = 'public';

  IF v_count = 1 THEN
    RAISE NOTICE 'SSOT Enforcement Complete: Single authoritative cache_alpha_thesis function | All overloads eliminated | HTTP 300 routing error RESOLVED';
  ELSE
    RAISE WARNING 'WARNING: Function count is %, expected 1. Review for additional overloads.', v_count;
  END IF;
END $$;
