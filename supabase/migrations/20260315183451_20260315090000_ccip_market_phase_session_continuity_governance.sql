/*
  # CCIP-2026-03-15: Market Phase & Session Continuity Governance Audit

  No schema changes. Audit record only.

  Problem: Alpha received session name but no pre-computed market phase state,
  causing inconsistent session_phase synthesis each cycle.

  Fix: deriveMarketPhase() maps existing regime oracle signals to unified phase label.
  SessionContext extended with next session transition. Alpha reads phase as data.

  SSOT owner: src/utils/market-phase-deriver.ts
  CCIP compliance: No instruction changes, no alpha authority changes.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  reason,
  new_value,
  metadata
)
VALUES (
  'alpha_prompt_config',
  gen_random_uuid(),
  'ccip_migration_applied',
  'CCIP-2026-03-15: Market phase pre-computation wired into Alpha briefing. deriveMarketPhase() maps regime oracle signals to unified phase label. SessionContext extended with next session transition data. Alpha reads phase as data, not as inference task.',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-03-15',
    'description', 'Session continuity — pre-computed market phase delivery',
    'files_changed', jsonb_build_array(
      'src/utils/marketHours.ts',
      'src/utils/market-phase-deriver.ts',
      'src/types/market-briefing.ts',
      'src/services/market-briefing-builder.ts',
      'src/services/alpha-omega-orchestrator.ts',
      'src/config/alpha-identity.ts'
    ),
    'ssot_owner', 'src/utils/market-phase-deriver.ts',
    'breaking_change', false,
    'alpha_authority_affected', false
  ),
  jsonb_build_object('status', 'applied', 'migration', '20260315090000')
);
