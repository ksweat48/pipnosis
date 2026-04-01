/*
  # CCIP-2026-0401A: Eradicate Confidence Band Numeric Anchors from Phase Calibration

  ## Root Cause
  The `alpha_phase_confluence_calibration` table contains `expected_confidence_band_min`
  and `expected_confidence_band_max` columns (e.g. 55-70%) that were being read by
  `AlphaIntelligenceAggregator.getPhaseConfluenceCalibration()` and formatted into the
  live GPT-4o system prompt as explicit numeric ranges (e.g. "55-70%").

  GPT-4o treated these as authoritative scoring rubrics. In ACCUMULATION (the most common
  market state), the band was 55-70%. Any advisory signal or uncertainty caused the model
  to land just below the minimum — outputting trade_confidence: 45 deterministically on
  every pair, every scan.

  This is the same class of bug as CCIP-2026-0326A (removed phase band formulas from the
  static system prompt) and CCIP-2026-0332A (removed numeric example in NO_TRADE schema).
  Those patches fixed the static prompt. This patch fixes the dynamic database-fed
  re-injection that survived both previous fixes.

  ## Changes
  1. Drop NOT NULL constraint on band columns so they can be nulled.
  2. Null out `expected_confidence_band_min` and `expected_confidence_band_max` for all rows.
  3. Add a CHECK constraint ensuring both columns remain NULL permanently (governance lock).
  4. The prompt formatter in coordinator-alpha.ts (CCIP-2026-0401A) strips these columns
     from the prompt text entirely.

  ## SSOT Authority
  - Alpha's confidence is solely determined by Alpha's honest conviction about structural
    evidence (CCIP-2026-0326A, CCIP-2026-0332A, CCIP-2026-0401A).
  - No database-stored numeric range may be injected into a prompt to anchor confidence.

  ## Affected Tables
  - `alpha_phase_confluence_calibration`: NOT NULL dropped, band columns nulled and locked
*/

ALTER TABLE alpha_phase_confluence_calibration
  ALTER COLUMN expected_confidence_band_min DROP NOT NULL,
  ALTER COLUMN expected_confidence_band_max DROP NOT NULL;

UPDATE alpha_phase_confluence_calibration
SET
  expected_confidence_band_min = NULL,
  expected_confidence_band_max = NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'alpha_phase_confluence_calibration'
      AND constraint_name = 'no_confidence_band_anchors'
  ) THEN
    ALTER TABLE alpha_phase_confluence_calibration
      ADD CONSTRAINT no_confidence_band_anchors
      CHECK (expected_confidence_band_min IS NULL AND expected_confidence_band_max IS NULL);
  END IF;
END $$;
