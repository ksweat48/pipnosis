/*
  # Enforce Style Immutability Governance

  1. Governance Change
    - Records the enforcement of style immutability as a system-wide governance rule
    - Trade styles (SCALP, MICRO_INTRADAY, INTRADAY) are IMMUTABLE once chosen
    - No auto-upgrade, promotion, or downgrade is permitted
    - When a trade does not fit the style, the ONLY resolution is NO_TRADE

  2. Affected Components
    - coordinator-alpha.ts: Constraint sandwich pre-flight check added
    - style-execution-envelopes.ts: detectConstraintSandwich function added
    - pipnosis-core-rules.ts: Style upgrade language purged
    - llm-snapshot-builder.ts: Style upgrade prompts removed
    - omega9-constraint-provider.ts: Style change options removed
    - constraint-feasibility-validator.ts: Style downgrade suggestions removed
    - style-personalities.ts: upgradeCondition config removed
    - risk-strategy-profiles.ts: Style progression comments corrected
    - profit-target-calculator.ts: Style upgrade advisory removed

  3. Security
    - No RLS changes required (governance log table already has RLS)
    - Uses existing governance_change_log infrastructure
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"policy": "style_upgrades_permitted", "behavior": "SCALP auto-upgrades to MICRO_INTRADAY when duration exceeds band"}'::jsonb,
  '{"policy": "style_immutability_enforced", "behavior": "NO_TRADE when style constraints are infeasible, NEVER upgrade style"}'::jsonb,
  'CCIP: Enforce absolute style immutability across entire system. Trade styles are IMMUTABLE once chosen. Constraint sandwich detection added for instruments where noise floor exceeds style SL max.',
  '{"ccip_version": "2.0", "affected_files": ["coordinator-alpha.ts", "style-execution-envelopes.ts", "pipnosis-core-rules.ts", "llm-snapshot-builder.ts", "omega9-constraint-provider.ts", "constraint-feasibility-validator.ts", "style-personalities.ts", "risk-strategy-profiles.ts", "profit-target-calculator.ts"], "constraint_sandwich": "When noise floor > style SL max, HARD BLOCK with NO_TRADE advisory"}'::jsonb
);
