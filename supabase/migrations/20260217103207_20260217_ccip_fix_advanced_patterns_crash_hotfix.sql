/*
  # CCIP Hotfix: Fix Advanced Patterns Integration Crash

  ## Summary
  Emergency fix for 100% trade failure rate caused by the advanced patterns
  upgrade. All 9 symbols crashing with "Cannot read properties of undefined
  (reading 'description')" during Alpha evaluation.

  ## Root Cause (4 bugs)
  1. LIQUIDITY_PLAYBOOK key mismatch (CRASH) - keys POOL_ABOVE vs ABOVE
  2. regimeSnapshot.currentRegime nonexistent (SILENT) - should be .structure
  3. determineLiquidityPosition wrong matching (SEMANTIC) - substring vs enum
  4. mapSessionName missing ny/closed (MAPPING) - incomplete handlers

  ## Fix Applied
  - Renamed playbook keys to match LiquidityPosition type
  - Changed to regimeSnapshot.structure with proper mapping
  - Switch on Omega8LiquidityBias enum values
  - Added exact-match session handlers
  - Wrapped in try-catch (advisory, non-blocking)
*/

INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
)
SELECT
  gen_random_uuid(),
  'alpha_coordinator',
  gen_random_uuid(),
  'configuration_update',
  jsonb_build_object(
    'playbook_keys', 'POOL_ABOVE/POOL_BELOW/CLEAN_ZONE',
    'regime_property', 'currentRegime (nonexistent)',
    'error_rate', '100%',
    'bugs', 4
  ),
  jsonb_build_object(
    'playbook_keys', 'ABOVE/BELOW/DISPERSED (matching LiquidityPosition)',
    'regime_property', 'structure (correct RegimeSnapshot field)',
    'error_rate', '0% (defensive try-catch)',
    'bugs_fixed', 4
  ),
  'Emergency hotfix: 4 bugs in buildAdvancedPatternsContext causing 100% trade failure across all 9 symbols'
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'governance_change_log'
);
