/*
  # CCIP: Style-Aware Omega Council Governance

  ## Summary
  Records the architectural upgrade that made all five Omega specialist brains
  (Trend, Scalper, Confirmation, Reversal, Volatility) style-aware. Each specialist
  now receives tradeStyle (SCALP | MICRO_INTRADAY | INTRADAY) and applies
  style-calibrated scoring weights and thresholds.

  ## Problem Solved
  Previously all five specialists were style-agnostic — every style received identical
  Omega intelligence, leaving 100% of style-interpretation burden on Alpha LLM.

  ## Changes Made
  1. Omega-1 Trend: style-aware EMA weighting (SCALP=0.3, INTRADAY=0.5), mixed stack penalty
  2. Omega-2 Scalper: VWAP weight (SCALP=1.0, INTRADAY=0.3), chase-risk penalty scaling
  3. Omega-3 Confirmation: INTRADAY SR tighter threshold, MTF missing penalty, thresholds 30/35/40
  4. Omega-4 Reversal: SCALP tighter RSI, divergence weight INTRADAY=1.4x/SCALP=0.7x
  5. Omega-5 Volatility: ATR compression SCALP=+20/INTRADAY=-15, expansion SCALP=-10/INTRADAY=+15
  6. Orchestrator: resolvedOmegaStyle wired to all five Omega evaluate() calls
  7. Alpha Coordinator: buildOmegaVerificationSummary prepends style-lens header

  ## Security
  Governance record only. No new tables, no RLS changes.
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
  deployed_at,
  rollback_criteria
) VALUES (
  '20260218-style-aware-omega-council',
  'Style-Aware Omega Council: All 5 specialists receive tradeStyle for calibrated intelligence',
  'All five Omega council specialists now receive tradeStyle (SCALP|MICRO_INTRADAY|INTRADAY) and apply style-calibrated scoring weights and thresholds. Previously style-agnostic — every style received identical intelligence, leaving 100% of style-interpretation burden on Alpha.',
  '{"components": ["src/brains/omega/trend.ts", "src/brains/omega/scalper.ts", "src/brains/omega/confirmation.ts", "src/brains/omega/reversal.ts", "src/brains/omega/volatility.ts", "src/services/alpha-omega-orchestrator.ts", "src/brains/coordinator-alpha.ts"]}'::jsonb,
  'high',
  true,
  true,
  true,
  true,
  true,
  true,
  'deployed',
  true,
  true,
  now(),
  '{"strategy": "Revert tradeStyle parameter from all five Omega snapshot interfaces and remove resolvedOmegaStyle extraction from orchestrator makeTradeDecision. Remove style-lens header from buildOmegaVerificationSummary."}'::jsonb
) ON CONFLICT (change_id) DO NOTHING;
