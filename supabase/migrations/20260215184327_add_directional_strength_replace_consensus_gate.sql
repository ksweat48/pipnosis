/*
  # Replace Consensus Gate with Directional Strength Model

  CCIP-2026-02-15: Mandatory Directional Voting Enforcement

  ## Summary
  All Omega advisors now MUST vote BUY or SELL with confidence 1-100%.
  NO_TRADE is exclusively an Alpha-level decision.
  The old consensus gate (NO_TRADE quorum) is replaced with a directional
  strength model that measures net conviction (buyScore - sellScore).

  ## Changes to `alpha_decisions` table
  - Add `directional_strength_net` (numeric) - net directional strength score
  - Add `directional_strength_buy` (numeric) - weighted buy score
  - Add `directional_strength_sell` (numeric) - weighted sell score
  - Add `directional_strength_threshold` (numeric) - style threshold used
  - Add `directional_strength_meets` (boolean) - whether threshold was met
  - Add `directional_strength_style` (text) - trade style used for threshold

  ## Security
  - No RLS changes needed (alpha_decisions RLS already in place)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'directional_strength_net'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN directional_strength_net numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'directional_strength_buy'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN directional_strength_buy numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'directional_strength_sell'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN directional_strength_sell numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'directional_strength_threshold'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN directional_strength_threshold numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'directional_strength_meets'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN directional_strength_meets boolean;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'directional_strength_style'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN directional_strength_style text;
  END IF;
END $$;

COMMENT ON COLUMN alpha_decisions.directional_strength_net IS 'CCIP-2026-02-15: Net directional strength (|buyScore - sellScore|)';
COMMENT ON COLUMN alpha_decisions.directional_strength_buy IS 'CCIP-2026-02-15: Weighted buy score from omega council';
COMMENT ON COLUMN alpha_decisions.directional_strength_sell IS 'CCIP-2026-02-15: Weighted sell score from omega council';
COMMENT ON COLUMN alpha_decisions.directional_strength_threshold IS 'CCIP-2026-02-15: Style-specific minimum threshold';
COMMENT ON COLUMN alpha_decisions.directional_strength_meets IS 'CCIP-2026-02-15: Whether net strength met the threshold';
COMMENT ON COLUMN alpha_decisions.directional_strength_style IS 'CCIP-2026-02-15: Trade style used for threshold lookup';
