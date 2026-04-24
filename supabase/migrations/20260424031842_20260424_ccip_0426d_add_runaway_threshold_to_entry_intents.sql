/*
  # CCIP-2026-0426D — Add runaway_threshold_pips to entry_intents

  ## Why this change
  When Alpha sets a wait_pullback or pending_zone_entry intent and price blows through
  the zone without pulling back (traveling toward the TP), the intent becomes stale.
  Alpha now reasons about how far past the zone edge price can travel before the move
  is "done without entry" and outputs runaway_threshold_pips as part of wait_condition.

  The autonomous-entry-monitor reads this field and auto-cancels the intent when price
  has traveled that many pips/points past the far zone edge in the direction of the TP.

  ## Schema changes
  1. Add runaway_threshold_pips NUMERIC column to entry_intents — nullable, no default.
     Alpha populates this. Monitor uses a per-symbol fallback if NULL.

  ## Security
  No RLS changes. Existing policies cover the new column.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'runaway_threshold_pips'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN runaway_threshold_pips NUMERIC;
  END IF;
END $$;

COMMENT ON COLUMN entry_intents.runaway_threshold_pips IS
  'CCIP-2026-0426D: pips/points past the far zone edge toward TP at which the move '
  'is considered done without entry. Set by Alpha as part of wait_condition reasoning. '
  'NULL = use per-symbol default in autonomous-entry-monitor.';

NOTIFY pgrst, 'reload schema';
