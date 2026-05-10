/*
  # CCIP-2026-0510C — Continuous Confidence Per Scan

  ## Problem
  Every Alpha decision in the admin dashboard displayed the same `confidence=65`
  because `confidence_tier` is mapped to a fixed integer midpoint. Users could
  not distinguish genuinely stronger opportunities from routine scans.

  ## Change
  Add a new `confidence_continuous` numeric column to `alpha_decisions`. Alpha
  still outputs a text `confidence_tier`, but downstream code now also writes
  a continuous score inside the tier's band (e.g. 60-69 for confident) derived
  from `Q5_failure_probability` and `counter_thesis_probability`. The tier
  stays authoritative for coarse classification; the continuous score makes
  per-scan spread visible.

  ## Tables Modified
  - `alpha_decisions`
    - `confidence_continuous` (numeric, nullable) — continuous score 0-100
      inside the tier band. Nullable so historical rows remain untouched.

  ## Security
  No RLS changes. Existing `alpha_decisions` policies apply unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'alpha_decisions'
      AND column_name = 'confidence_continuous'
  ) THEN
    ALTER TABLE public.alpha_decisions
      ADD COLUMN confidence_continuous numeric;
    COMMENT ON COLUMN public.alpha_decisions.confidence_continuous IS
      'CCIP-2026-0510C: Continuous confidence score (0-100) within the tier band. Derived from Q5_failure_probability and counter_thesis_probability so each scan has a unique confidence rather than the tier midpoint.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
