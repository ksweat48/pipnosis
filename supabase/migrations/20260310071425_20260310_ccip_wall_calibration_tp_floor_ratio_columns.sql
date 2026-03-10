/*
  # Add TP Floor Ratio Columns to Wall Calibration Events

  ## Summary
  CCIP-2026-03-10: Wire TP_FLOOR_RATIO_BY_REGIME into WallCalibrationEngine.

  The TP_FLOOR_RATIO_BY_REGIME config existed (low=0.50, medium=0.75, high=1.00)
  but was never applied — it was dead code. This migration adds the audit columns
  to track when the envelope TP floor is compressed in low/medium volatility,
  preventing zero-width corridors during Asian session scanning.

  ## New Columns (wall_calibration_events)
  - `calibrated_envelope_tp_min_pips` — The effective TP floor after applying
    TP_FLOOR_RATIO_BY_REGIME. In low volatility this will be 50% of the raw
    envelope floor. In high volatility it equals the raw envelope floor.
  - `tp_floor_ratio_applied` — The ratio applied (0.50/0.75/1.00). Allows
    governance queries to see how often floor compression was needed.

  ## Security
  - No RLS changes — inherits existing wall_calibration_events policies
  - Both columns are nullable to allow migration with existing rows

  ## SSOT Compliance
  - All calibration constants remain in wall-calibration-config.ts
  - WallCalibrationEngine is sole authority for corridor adaptation
  - Audit trail preserved: every calibration logged with ratio for full traceability
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wall_calibration_events'
      AND column_name = 'calibrated_envelope_tp_min_pips'
  ) THEN
    ALTER TABLE wall_calibration_events
      ADD COLUMN calibrated_envelope_tp_min_pips numeric(10,2);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wall_calibration_events'
      AND column_name = 'tp_floor_ratio_applied'
  ) THEN
    ALTER TABLE wall_calibration_events
      ADD COLUMN tp_floor_ratio_applied numeric(5,3);
  END IF;
END $$;
