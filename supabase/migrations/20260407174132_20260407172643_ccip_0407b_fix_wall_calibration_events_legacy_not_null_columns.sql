/*
  # Fix wall_calibration_events Legacy NOT NULL Columns

  ## Summary
  After CCIP-2026-04-07a removed the static volatility classifier, two legacy columns
  in wall_calibration_events are no longer populated by the engine but still carry
  NOT NULL constraints, causing a 400 Bad Request on every audit insert.

  ## Changes
  1. `volatility_regime` (text, NOT NULL, no default)
     - The engine no longer classifies volatility regime labels
     - Alpha has sole authority over volatility interpretation
     - Make nullable — historical rows retain their existing values

  2. `regime_multiplier_used` (numeric, NOT NULL, default 1.0)
     - Renamed to `base_multiplier_used` in CCIP-2026-04-07a
     - Old column is a retired alias; new column `base_multiplier_used` already exists
     - Make nullable and set default to NULL — historical rows retain their values
     - The engine now sends `base_multiplier_used` exclusively

  ## Notes
  - NO columns are dropped; historical audit data is fully preserved
  - `calibrated_envelope_tp_min_pips` and `tp_floor_ratio_applied` are already nullable
  - `base_multiplier_used` already exists with DEFAULT 14 from previous migration
  - This is a non-destructive schema relaxation only
*/

ALTER TABLE wall_calibration_events
  ALTER COLUMN volatility_regime DROP NOT NULL,
  ALTER COLUMN regime_multiplier_used DROP NOT NULL;

ALTER TABLE wall_calibration_events
  ALTER COLUMN volatility_regime SET DEFAULT NULL,
  ALTER COLUMN regime_multiplier_used SET DEFAULT NULL;
