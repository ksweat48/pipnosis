/*
  # CCIP Coordinator Audit — 8 SSOT/Governance Fixes (2026-03-03)

  ## Summary
  Post-improvement audit of shared-intelligence-coordinator.ts identified 8 violations
  spanning CRITICAL data-integrity bugs through LOW housekeeping issues. All 8 are resolved
  in this migration. No schema changes are required — this migration records the CCIP
  change-log entry for full audit traceability.

  ## Changes Recorded

  ### CRITICAL (1)
  1. Cache key prefix mismatch in invalidateThesisForSymbol() — H1+ eviction was a no-op

  ### HIGH (2)
  2. Missing try-catch around logThesisRejection / invalidateThesisByRegime in fetchPromise
  3. Hardcoded '$0.20' LLM cost strings extracted to ALPHA_THESIS_LLM_COST_PER_CALL

  ### MEDIUM (3)
  4. Magic number 60 (fresh-cache threshold) extracted to TIME_MS.CACHE.FRESH_SKIP_HASH_SECONDS
  5. 7 raw console.* calls replaced with structured logger.*
  6. Hardcoded default fallback strings extracted to THESIS_DEFAULTS

  ### LOW (2)
  7. @deprecated JSDoc added to AlphaStrategicInsight
  8. Magic number 255 (error msg truncation) extracted to TIME_MS.CACHE.AUDIT_ERROR_MESSAGE_MAX_LENGTH

  ## Files Modified
  - src/config/time-constants.ts
  - src/types/alpha-thesis.ts
  - src/services/shared-intelligence-coordinator.ts

  ## No Destructive Changes
  No tables dropped, no columns removed, no data deleted.
*/

INSERT INTO ccip_changes (
  change_id,
  title,
  description,
  affected_components,
  severity,
  system_map_completed,
  logic_contract_completed,
  dry_run_completed,
  compatibility_check_completed,
  staged_deployment_completed,
  post_deploy_monitoring_completed,
  status,
  ccip_compliant,
  retroactive_documentation,
  deployed_at
) VALUES (
  'CCIP-COORDINATOR-AUDIT-2026-03-03',
  'Coordinator Audit: 8 SSOT/Governance Fixes',
  'Post-improvement audit of shared-intelligence-coordinator.ts resolved 8 violations: (1) CRITICAL cache key prefix mismatch — invalidateThesisForSymbol() was scanning for "${symbol}_" but actual key format is "thesis:${symbol}:", silently making H1+ structural candle eviction a no-op; (2) HIGH missing try-catch around logThesisRejection/invalidateThesisByRegime inside fetchPromise IIFE — invalidateThesisByRegime re-throws on RPC failure, poisoning all concurrent callers sharing the thundering-herd in-flight Promise; (3) HIGH hardcoded "$0.20" cost strings in 2 log statements extracted to ALPHA_THESIS_LLM_COST_PER_CALL constant; (4) MEDIUM magic number 60 (fresh-cache hash-skip threshold) extracted to TIME_MS.CACHE.FRESH_SKIP_HASH_SECONDS; (5) MEDIUM 7 raw console.log/error calls replaced with structured logger.*; (6) MEDIUM hardcoded default thesis fallback strings extracted to THESIS_DEFAULTS; (7) LOW @deprecated JSDoc added to AlphaStrategicInsight; (8) LOW magic number 255 (error message truncation) extracted to TIME_MS.CACHE.AUDIT_ERROR_MESSAGE_MAX_LENGTH.',
  '["shared-intelligence-coordinator.ts", "time-constants.ts", "alpha-thesis.ts"]'::jsonb,
  'critical',
  true,
  true,
  true,
  true,
  true,
  false,
  'deployed',
  true,
  false,
  now()
)
ON CONFLICT (change_id) DO UPDATE SET
  status = 'deployed',
  staged_deployment_completed = true,
  deployed_at = now(),
  updated_at = now();
