/*
  # CCIP Governance Record: Sensor SSOT Boundary Enforcement

  ## Change Summary
  Removes all penalty computation from sensor services (regime-oracle, adversarial-detector).
  Both services now output raw observations only. Alpha Orchestrator is the sole authority
  for converting observations into confidence penalties.

  ## Contract Changes
  - RegimeSnapshot: removed risk_reduction_factor, confidence_penalty_percent, regime_classification
  - RegimeSnapshot: added spread_risk, is_dead_zone, is_session_overlap
  - AdversarialSignal: removed confidence_penalty field
  - SafetyFlags: removed risk_reduction_factor, confidence_penalty_percent, regime_classification, suggested_adjustments
  - Alpha Orchestrator: added computeRegimePenaltyFromRaw() and computeAdversarialPenaltyFromRaw()

  ## Files Modified
  - src/services/regime-oracle.ts (sensor - output only)
  - src/services/adversarial-detector.ts (sensor - output only)
  - src/services/alpha-omega-orchestrator.ts (SSOT scorer - new methods)
  - src/services/condition-monitor.ts (consumer - removed risk_reduction_factor)
  - src/services/safety-enforcer.ts (consumer - removed risk_reduction_factor)
  - src/services/market-snapshot-cache.ts (consumer - removed penalty fields)
  - src/brains/coordinator-alpha.ts (consumer - removed risk_reduction_factor prompt)
  - src/services/alpha-trade-executor.ts (consumer - removed regime_classification)
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
SELECT
  'system_configuration',
  gen_random_uuid(),
  'ccip_migration_applied',
  jsonb_build_object(
    'contract', 'sensor_services_v1',
    'fields_removed', ARRAY[
      'RegimeSnapshot.risk_reduction_factor',
      'RegimeSnapshot.confidence_penalty_percent',
      'RegimeSnapshot.regime_classification',
      'AdversarialSignal.confidence_penalty',
      'SafetyFlags.risk_reduction_factor',
      'SafetyFlags.confidence_penalty_percent',
      'SafetyFlags.regime_classification',
      'SafetyFlags.suggested_adjustments'
    ],
    'scoring_authority', 'regime-oracle + adversarial-detector (each computes own penalties)',
    'pattern', 'worst-case-wins + independent penalty fields'
  ),
  jsonb_build_object(
    'contract', 'sensor_services_v2',
    'fields_added', ARRAY[
      'RegimeSnapshot.spread_risk',
      'RegimeSnapshot.is_dead_zone',
      'RegimeSnapshot.is_session_overlap',
      'AlphaOmegaOrchestrator.computeRegimePenaltyFromRaw()',
      'AlphaOmegaOrchestrator.computeAdversarialPenaltyFromRaw()'
    ],
    'scoring_authority', 'alpha-omega-orchestrator (sole authority)',
    'pattern', 'additive composite scoring, 15% cap per domain, advisory-only'
  ),
  'CCIP: Sensor services must be pure observers. Alpha Orchestrator is the single source of truth for confidence scoring. Removes risk_reduction_factor multiplier format and confidence_penalty_percent fields from all sensor outputs. Alpha now scores raw observations directly via two new dedicated scoring methods.',
  jsonb_build_object(
    'ccip_ref', 'SSOT-SENSOR-BOUNDARY-2026-02-21',
    'breaking_change', true,
    'files_modified', 8,
    'penalty_cap_per_domain', '15%',
    'scoring_model', 'additive composite',
    'deprecated_model', 'worst-case-wins multiplier'
  )
;
