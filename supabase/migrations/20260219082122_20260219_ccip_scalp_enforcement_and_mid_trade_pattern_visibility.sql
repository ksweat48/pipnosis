/*
  # CCIP Change Record: Scalp Enforcement + Mid-Trade Pattern Visibility

  ## Title
  CCIP-2026-0219: Scalp Momentum/Pattern Enforcement + MidTradeMonitor Scalp Intelligence Display

  ## Summary
  Closes the gap between scalp rule detection and enforcement. Prior to this change,
  scalp pattern, sub-mode, and momentum phase data was detected deterministically but
  presented to Alpha as "ADVISORY ONLY". This change enforces pattern selection,
  momentum compliance, and sub-mode discipline at the LLM prompt level, and persists
  the chosen scalp intelligence fields in the immutable mid_trade_plan JSONB column
  so they are visible in the MidTradeMonitor during live trade monitoring.

  ## Files Changed
  - src/brains/coordinator-alpha.ts (prompt enforcement upgrade)
  - src/services/mid-trade-plan-engine.ts (MidTradePlan interface + builder)
  - src/services/alpha-trade-executor.ts (scalp field passthrough)
  - src/components/MidTradeMonitor.tsx (ScalpIntelligenceBar display)

  ## SSOT / CCIP / Governance Compliance
  - No DDL changes: mid_trade_plan is JSONB; new fields are additive and non-breaking
  - No RLS changes required
  - Backward-compatible: existing trades without scalp fields render with no bar
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
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"enforcement": "advisory_only", "scalp_fields_in_json": false, "scalp_fields_in_plan": false, "scalp_visible_in_monitor": false}',
  '{"enforcement": "mandatory_compliance_gate", "scalp_fields_in_json": true, "scalp_fields_in_plan": true, "scalp_visible_in_monitor": true, "fields": ["scalp_pattern", "scalp_sub_mode", "scalp_momentum_phase", "scalp_atr_traveled"]}',
  'CCIP-2026-0219: Upgrade scalp intelligence from advisory-only to mandatory compliance gate. Enforce pattern selection, momentum phase compliance, sub-mode discipline in prompt. Add four scalp fields to Alpha JSON output, MidTradePlan snapshot, and MidTradeMonitor display.',
  '{"ccip_id": "CCIP-2026-0219", "breaking_change": false, "rollback_safe": true, "files_changed": ["src/brains/coordinator-alpha.ts", "src/services/mid-trade-plan-engine.ts", "src/services/alpha-trade-executor.ts", "src/components/MidTradeMonitor.tsx"]}'
);
