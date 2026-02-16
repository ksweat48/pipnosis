/*
  # CCIP: Fix TP1 Wall Violation Cascade and Monitor Disconnect

  ## Problem
  Alpha was unable to execute ANY trades due to a cascading failure:
  1. TP1 calculator found no liquidity zone within 0.8-1.5x ATR range
  2. TP1 fallback produced conservative value: min(slDistance, tpDistance * 0.6)
  3. SCALP TP2 suppression forced final TP = TP1 (this small value)
  4. Arena wall check found TP below wall minimum -> WALL VIOLATION -> NO_TRADE
  5. Real-Time Intelligence Monitor showed 11 "Ready" pairs (misleading)

  ## Changes Made
  1. coordinator-alpha.ts: Wall-aware TP1 fallback + SCALP suppression wall guard
  2. tp1-probability-calculator.ts: Expanded search range (0.6-2.0x ATR secondary pass)
  3. risk-aware-stop-calculator.ts: Style-aware noise floor cap (SCALP 3x ATR max)
  4. omega9-constraint-provider.ts: Pass trade style to noise floor calculation
  5. realtime-intelligence-calculator.ts: Cap infeasible pair confidence at 50%
  6. SessionIntelligenceMonitor.tsx: Exclude infeasible pairs from "Ready" count

  ## SSOT Compliance
  - Each authority file retains sole ownership of its domain
  - Downstream systems now receive upstream constraint info (wall-awareness)
  - No duplicate logic introduced

  ## Security
  - No new tables, no RLS changes, no data mutations
  - Pure CCIP audit record
*/

INSERT INTO ccip_changes (
  id,
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
  deployed_at,
  rollback_criteria,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'CCIP-2026-02-16-TP1-CASCADE-FIX',
  'Fix TP1 Wall Violation Cascade and Monitor Disconnect',
  'Resolved cascading failure where TP1 fallback + SCALP TP2 suppression + arena wall check combined to block ALL trade execution. Added wall-awareness to TP1 fallback and SCALP suppression, expanded TP1 search range with confidence penalty, style-aware noise floor cap for SCALP (3x ATR max), and fixed Real-Time Intelligence Monitor to exclude infeasible pairs from Ready designation.',
  '["coordinator-alpha.ts", "tp1-probability-calculator.ts", "risk-aware-stop-calculator.ts", "omega9-constraint-provider.ts", "realtime-intelligence-calculator.ts", "SessionIntelligenceMonitor.tsx"]'::jsonb,
  'critical',
  true,
  true,
  true,
  true,
  false,
  false,
  'deployed',
  true,
  false,
  now(),
  '{"monitor_for": "24h", "rollback_if": "trade execution rate drops below baseline or false positive trades appear"}'::jsonb,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
