/*
  # Add MTF Conflict Stance to Alpha Decisions

  1. Modified Tables
    - `alpha_decisions`
      - Added `mtf_conflict_stance` (text, nullable) — Alpha's free-text reasoning about how
        opposing timeframe pattern directions informed his geometry, confidence, or entry mode.
        Null when all timeframes agree (pattern_tf_direction_agreement = 3/3).

  2. Purpose
    - Audit trail visibility into whether Alpha acknowledged and reasoned about multi-timeframe
      pattern conflicts rather than silently ignoring them.
    - Advisory data only — no gates, blocks, or constraints.

  3. CCIP Reference: CCIP-2026-0517B-MTF-CONFLICT-REASONING
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'mtf_conflict_stance'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN mtf_conflict_stance text;
  END IF;
END $$;
