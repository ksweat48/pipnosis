/*
  # Add quality_score column to alpha_hunt_readiness

  ## Summary
  Adds a numeric quality score (0–100) to each readiness row.
  This score powers the PC5 gate: only setups scoring ≥ 60 surface
  as ready/live in the UI. Scores below 60 are stored as not_ready
  so the UI displays only setups where Alpha is likely to return
  confident tier or higher.

  ## Changes
  - `alpha_hunt_readiness`: add `quality_score` integer column (default 0)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'quality_score'
  ) THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN quality_score integer NOT NULL DEFAULT 0;
  END IF;
END $$;
