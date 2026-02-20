/*
  # CCIP Mid-Trade Monitor UI + Duration Governance

  ## Summary
  Three coordinated changes under CCIP governance:

  1. Mid-Trade Monitor UI cleanup
     - Removed SL / Entry / TP price boxes (not needed on this monitor view)
     - Removed Thesis intact/broken status row (redundant with guidance message)
     - Setup type pill (BOS Retest, Liquidity Sweep, etc.) promoted to always-visible header
     - Duration pill promoted to always-visible header with colour coding:
       green = under 2h, amber = 2-6h, red = over 6h

  2. Alpha Coordinator dead penalty compute removed
     - timeToFillCalculator was computing confidencePenalty/shouldApplyPenalty fields
       that were never applied to decision.confidence (dead compute, wasted cycles)
     - All viability/penalty/caution/reject branching removed from coordinator-alpha.ts
     - Only expectedFillTimeHours retained (feeds expected_duration_minutes for UI)

  3. Symbol velocity map extended in time-to-fill-calculator.ts
     - GBPUSD was using generic forex fallback (0.8) instead of correct velocity (1.2)
     - Added explicit entries for GBPJPY, AUDUSD, USDCAD, EURGBP, XAGUSD, NAS100

  ## SSOT Authority
  - Duration is advisory-only: never blocks or penalises Alpha confidence
  - Symbol velocity SSOT: time-to-fill-calculator.ts SYMBOL_VELOCITY map
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
VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'ccip_migration_applied',
  '{"sl_entry_tp_boxes":true,"thesis_status_row":true,"setup_pill_in_header":false,"duration_pill_in_header":false,"alpha_duration_penalty_branches":true,"gbpusd_velocity_explicit":false}'::jsonb,
  '{"sl_entry_tp_boxes":false,"thesis_status_row":false,"setup_pill_in_header":true,"duration_pill_in_header":true,"alpha_duration_penalty_branches":false,"gbpusd_velocity_explicit":true}'::jsonb,
  'CCIP 20260220: Remove SL/Entry/TP boxes and thesis row from mid-trade monitor. Promote setup type + duration pills to always-visible header. Remove dead penalty compute from alpha coordinator. Fix GBPUSD and other symbol velocities in time-to-fill calculator.',
  '{"ccip_ref":"20260220_mid_trade_monitor","files_changed":["src/components/MidTradeMonitor.tsx","src/brains/coordinator-alpha.ts","src/services/time-to-fill-calculator.ts"]}'::jsonb
);
