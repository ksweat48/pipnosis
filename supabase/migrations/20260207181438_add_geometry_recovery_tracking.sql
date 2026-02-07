/*
  # Add Geometry Recovery Tracking

  1. Modified Tables
    - `alpha_geometry_errors`
      - `recovery_applied` (boolean, default false) - Whether a label swap recovery was applied
      - `recovery_type` (text, nullable) - Type of recovery applied (e.g., 'SL_TP_LABEL_SWAP')

  2. Notes
    - Extends existing table to track when geometry errors are auto-corrected
    - Only SL/TP label swaps (both sides wrong, swap produces valid geometry) are recoverable
    - Single-side errors (SL_WRONG_SIDE, TP_WRONG_SIDE) remain hard-blocked
    - All corrections are logged for governance audit trail
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_geometry_errors' AND column_name = 'recovery_applied'
  ) THEN
    ALTER TABLE alpha_geometry_errors ADD COLUMN recovery_applied boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_geometry_errors' AND column_name = 'recovery_type'
  ) THEN
    ALTER TABLE alpha_geometry_errors ADD COLUMN recovery_type text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alpha_geometry_errors_recovery
  ON alpha_geometry_errors (recovery_applied, created_at DESC)
  WHERE recovery_applied = true;
