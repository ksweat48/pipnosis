/*
  # CCIP-2026-0321A: Alpha-Owned Entry Deviation Tolerance

  ## Summary

  Replaces the system-computed, style-keyed deviation table (SCALP=5, MICRO=8, INTRADAY=15 pips)
  with a per-trade value that Alpha states directly in his output schema as `max_entry_deviation_pips`.
  Alpha sets this based on pair speed and structural precision of the specific entry. If the live
  fill exceeds Alpha's stated limit, the setup is cancelled — no trade placed, no rescan triggered.

  ## Schema Changes

  ### entry_price_deviation_events
  - Adds `alpha_max_deviation_pips` (integer, nullable) — Alpha's stated value at decision time.
    NULL means the decision predated this column or Alpha omitted it (fallback was used).
    When populated, this column records exactly what Alpha said versus what the system enforced,
    enabling governance audits to detect if Alpha is calibrating too tight or too loose per pair.

  ### entry_price_deviation_events — action_taken constraint
  - Removes `RESCAN_TRIGGERED` from the allowed action_taken values (deprecated — deviation
    blocks no longer trigger rescans; they cancel the setup outright).
  - Replaces with `CANCELLED` to represent the new "setup cancelled, no rescan" behaviour.
  - `BLOCKED` (legacy explicit block) and `SHIFTED` (within tolerance, geometry preserved) remain.

  ## Security
  - No new tables; no RLS changes required — inherits existing policies.

  ## Notes
  - Existing rows with action_taken='RESCAN_TRIGGERED' are preserved in place (the constraint
    only applies to new inserts). A separate backfill is not needed because governance forensics
    use the block_reason text field for precise classification.
*/

-- 1. Add alpha_max_deviation_pips column (nullable integer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_price_deviation_events'
      AND column_name = 'alpha_max_deviation_pips'
  ) THEN
    ALTER TABLE entry_price_deviation_events
      ADD COLUMN alpha_max_deviation_pips integer;
  END IF;
END $$;

-- 2. Update action_taken constraint to remove RESCAN_TRIGGERED and add CANCELLED
ALTER TABLE entry_price_deviation_events
  DROP CONSTRAINT IF EXISTS entry_price_deviation_events_action_taken_check;

ALTER TABLE entry_price_deviation_events
  ADD CONSTRAINT entry_price_deviation_events_action_taken_check
  CHECK (action_taken IN ('SHIFTED', 'BLOCKED', 'CANCELLED'));

-- 3. Reclassify any existing RESCAN_TRIGGERED rows to BLOCKED (semantically equivalent)
UPDATE entry_price_deviation_events
SET action_taken = 'BLOCKED'
WHERE action_taken = 'RESCAN_TRIGGERED';
