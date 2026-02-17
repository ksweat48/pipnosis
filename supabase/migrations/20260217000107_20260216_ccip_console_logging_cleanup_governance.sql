/*
  # Console Logging Cleanup - CCIP Governance Audit

  1. Changes
    - Removed verbose console.log spam from Smart Close Reason Detector
    - Removed GoalSessionDashboard health check logging (runs every 3 seconds)
    - Removed PollingOrchestrator zero-count health summary logging (runs every 30 seconds)
    - Removed TradeClosedActionDialog override logging

  2. Root Cause Analysis
    - Smart Close Reason Detector: logged 5+ lines per closed trade on every render cycle
    - GoalSessionDashboard: health check RPC logged governance_log_id every 3 seconds
    - PollingOrchestrator: health summary always showed zeros (hardcoded) every 30 seconds
    - Combined: 20+ console entries per minute of pure noise

  3. SSOT Compliance
    - No business logic changed
    - Detection algorithms unchanged
    - Health checks still execute, just silenced
    - Polling orchestrator monitoring unchanged

  4. Files Modified
    - src/utils/close-reason-detector.ts
    - src/components/GoalSessionDashboard.tsx
    - src/services/polling-orchestrator.ts
    - src/components/TradeClosedActionDialog.tsx
*/

INSERT INTO governance_change_log (
  id,
  entity_type,
  entity_id,
  operation,
  reason,
  metadata,
  created_at
) VALUES (
  gen_random_uuid(),
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  'Production console flooded with diagnostic spam: 20+ entries per minute from health checks, close reason detector, and polling orchestrator. Zero functional changes - logging removed, detection logic unchanged.',
  jsonb_build_object(
    'title', 'Console Logging Cleanup',
    'date', '2026-02-16',
    'files_modified', jsonb_build_array(
      'src/utils/close-reason-detector.ts',
      'src/components/GoalSessionDashboard.tsx',
      'src/services/polling-orchestrator.ts',
      'src/components/TradeClosedActionDialog.tsx'
    ),
    'ssot_compliance', true,
    'ccip_tracking_id', 'CCIP-2026-02-16-LOGGING-CLEANUP'
  ),
  now()
);
