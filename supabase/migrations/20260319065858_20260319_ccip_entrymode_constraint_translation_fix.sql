/*
  # CCIP-2026-0319-ENTRYMODE: entry_intents entry_mode constraint alignment

  ## Summary
  Defensive migration to ensure the DB check constraint on entry_intents.entry_mode
  accepts 'execute_now' and 'push_confirmation' alongside the pre-existing DB values.

  ## Root Cause
  Alpha's coordinator (coordinator-alpha.ts) uses an internal vocabulary:
    - 'execute_now'       (maps to DB 'immediate')
    - 'wait_pullback'     (same as DB)
    - 'push_confirmation' (maps to DB 'wait_confirmation')

  The SSOT translation helper toDbEntryMode() in alpha-trade-executor.ts is the
  authoritative translation point. However, as a belt-and-suspenders guard this
  migration also adds 'execute_now' and 'push_confirmation' to the DB constraint
  so that any accidental untranslated write does NOT cause a silent execution block.

  ## Changes
  - Drops the existing entry_intents_entry_mode_check constraint
  - Recreates it to also allow 'execute_now' and 'push_confirmation'

  ## Security
  - No RLS changes — this is a check constraint update only
  - No data modified

  ## Important Notes
  1. The canonical translation remains in alpha-trade-executor.ts (toDbEntryMode).
  2. This constraint expansion is purely defensive — the DB now accepts both the
     internal and the translated forms, preventing future silent failures.
  3. CCIP ref: CCIP-2026-0319-ENTRYMODE
*/

ALTER TABLE entry_intents
  DROP CONSTRAINT IF EXISTS entry_intents_entry_mode_check;

ALTER TABLE entry_intents
  ADD CONSTRAINT entry_intents_entry_mode_check
  CHECK (entry_mode IN (
    'immediate',
    'wait_pullback',
    'wait_confirmation',
    'execute_now',
    'push_confirmation'
  ));
