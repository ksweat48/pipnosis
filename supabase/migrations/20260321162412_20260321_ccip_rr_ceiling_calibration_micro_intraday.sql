/*
  # CCIP-2026-03-21: R:R Ceiling Calibration — MICRO_INTRADAY and INTRADAY

  ## Summary
  Calibrates the per-style R:R ceilings for MICRO_INTRADAY (2.0 → 3.0) and
  INTRADAY (3.0 → 4.0) to match the actual pip ranges defined in the style
  personalities configuration. SCALP ceiling (2.0) is already correct and unchanged.

  ## Rationale
  The ceilings are emergency walls that activate only when Alpha's TP placement
  would drift into a higher style's territory. They must sit at the upper edge
  of each style's natural output — not in the middle of it.

  Natural R:R bands derived from style-personalities.ts referenceRanges:
    - SCALP:          10-25 pip TP / 10-18 pip SL -> 1.4x-2.0x  -> ceiling 2.0 (correct, unchanged)
    - MICRO_INTRADAY: 50-120 pip TP / 20-35 pip SL -> 2.0x-3.4x  -> ceiling raised 2.0 -> 3.0
    - INTRADAY:       100-200 pip TP / 35-60 pip SL -> 2.0x-4.0x  -> ceiling raised 3.0 -> 4.0

  ## Changes
  - No schema changes (this is a frontend config constant).
  - This migration serves as the CCIP audit record for the governance decision.

  ## Impact
  - Alpha can now place MICRO_INTRADAY TPs up to 3R without being clamped.
  - Alpha can now place INTRADAY TPs up to 4R without being clamped.
  - Ceilings still prevent style drift: a MICRO trade cannot run to 3.5R
    (INTRADAY territory), and an INTRADAY trade cannot run to 4.5R (SWING).
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
  'system_configuration',
  gen_random_uuid(),
  'configuration_update',
  '{"MAXIMUM_SCALP": 2.0, "MAXIMUM_MICRO_INTRADAY": 2.0, "MAXIMUM_INTRADAY": 3.0}'::jsonb,
  '{"MAXIMUM_SCALP": 2.0, "MAXIMUM_MICRO_INTRADAY": 3.0, "MAXIMUM_INTRADAY": 4.0}'::jsonb,
  'CCIP-2026-03-21: R:R ceilings calibrated to upper edge of each style natural pip band. MICRO ceiling 2.0->3.0 (was clipping natural 2.0x-3.4x range). INTRADAY ceiling 3.0->4.0 (was clipping upper structural targets in 2.0x-4.0x range). Config key: trading-constants.ts:RISK_REWARD_RATIOS',
  '{"ccip_id": "CCIP-2026-03-21-RR-CEILING-CALIBRATION", "config_key": "trading-constants:RISK_REWARD_RATIOS", "deployed_by": "system"}'::jsonb
);
