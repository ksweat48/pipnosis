/*
  # Add Phase-Aware Columns to pre_screen_results

  ## Purpose
  Extends pre_screen_results with phase context data written by the updated
  pre-screen-structure-monitor Netlify function (CCIP-2026-0325C).

  ## New Columns
  - market_phase: Detected market phase (ACCUMULATION/EXPANSION/DISTRIBUTION/RETRACEMENT/REVERSAL/UNKNOWN)
  - load_bearing_signals: Which of the firing signals are load-bearing for this phase
  - phase_min_signals: Minimum signals required per calibration for this phase+style
  - phase_confidence_band_min: Lower bound of expected confidence band
  - phase_confidence_band_max: Upper bound of expected confidence band

  ## Notes
  - All columns are nullable for backwards compatibility
  - Existing rows will have NULL values until next monitor run
  - No existing columns or constraints are changed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'market_phase'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN market_phase text DEFAULT 'UNKNOWN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'load_bearing_signals'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN load_bearing_signals text[] DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'phase_min_signals'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN phase_min_signals integer DEFAULT 3;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'phase_confidence_band_min'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN phase_confidence_band_min integer DEFAULT 50;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pre_screen_results' AND column_name = 'phase_confidence_band_max'
  ) THEN
    ALTER TABLE pre_screen_results ADD COLUMN phase_confidence_band_max integer DEFAULT 65;
  END IF;
END $$;
