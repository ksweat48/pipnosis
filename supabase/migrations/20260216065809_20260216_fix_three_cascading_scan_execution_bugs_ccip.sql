/*
  # CCIP Governance: Fix Three Cascading Scan Execution Bugs

  ## Summary
  Documents and tracks three critical bug fixes that prevented individual pair scanning
  from completing successfully. These bugs cascaded: Bug 1 caused fallback data,
  Bug 2 caused UUID type errors in strategy_playbook queries, and Bug 3 caused
  a runtime crash on playbook creation.

  ## Changes Tracked

  ### Bug 1: marketSnapshotCache.get() method does not exist
  - File: src/services/zone-calculation-input-provider.ts
  - Root Cause: Called .get(symbol) but the SSOT method is .getSnapshot(symbol, timeframe, riskMode?)
  - Also Fixed: Property access from snapshot.indicators.atr to snapshot.atr.value and snapshot.indicators.vwap to snapshot.vwap
  - Impact: Zone calculation always fell back to percentage-based estimates instead of real ATR/VWAP data

  ### Bug 2: getActivePlaybook() called with wrong parameter order
  - File: src/services/event-based-llm-engine.ts
  - Root Cause: Called as (symbol, timeframe, structure, adversarial) but signature is (userId, symbol, timeframe, mode, regimeBucket)
  - Impact: Strategy playbook lookup always failed with database type error

  ### Bug 3: riskPercent undefined + createPlaybookEntry does not exist
  - File: src/services/event-based-llm-engine.ts
  - Root Cause: riskPercent variable was never declared (should use baseRiskPercent), and createPlaybookEntry does not exist on StrategyPlaybookManager (correct method is createPlaybookVariant with PlaybookBaseParams)
  - Impact: Runtime crash when attempting to auto-create a playbook for new strategy variants

  ## SSOT Compliance
  - Zone calculation now correctly uses MarketSnapshotCache SSOT interface
  - Playbook operations now correctly use StrategyPlaybookManager SSOT interface
  - Risk percentage sourced from getRiskPercentage() SSOT (baseRiskPercent)
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  old_value,
  new_value
)
VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  'CCIP: Fixed three cascading bugs preventing individual pair scanning - (1) marketSnapshotCache.get() replaced with getSnapshot() SSOT method, (2) getActivePlaybook parameter order corrected to match (userId, symbol, timeframe, mode, regimeBucket), (3) riskPercent replaced with baseRiskPercent and createPlaybookEntry replaced with createPlaybookVariant',
  jsonb_build_object(
    'bug1_zone_input_provider', 'marketSnapshotCache.get(symbol) - method does not exist',
    'bug2_playbook_params', 'getActivePlaybook(symbol, timeframe, structure, adversarial) - wrong order, symbol passed as userId',
    'bug3_playbook_create', 'createPlaybookEntry does not exist, riskPercent undefined'
  ),
  jsonb_build_object(
    'bug1_fix', 'marketSnapshotCache.getSnapshot(symbol, M15) with direct property access',
    'bug2_fix', 'getActivePlaybook(userId, symbol, timeframe, mode, regimeBucket)',
    'bug3_fix', 'createPlaybookVariant with PlaybookBaseParams, baseRiskPercent',
    'files_modified', ARRAY['src/services/zone-calculation-input-provider.ts', 'src/services/event-based-llm-engine.ts'],
    'severity', 'critical',
    'ccip_protocol', 'tier7'
  )
);