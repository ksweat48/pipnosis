/*
  # CCIP-2026-0513E — Entry Intents updated_at + PostgREST Schema Reload

  ## Summary
  Two-part fix unblocking the entry-monitor freeze observed on 2026-05-13:

  1. `entry_intents` is missing an `updated_at` column. The client's
     `getActiveEntryIntent` query orders by `created_at, updated_at` to be
     tolerant of read-replica lag. With the column absent, every poll returns
     PostgREST 400 and `EntryPriceMonitor` never mounts, leaving the UI stuck
     on the "Scanning..." splash even after Alpha announces execution.
  2. RPCs `record_trigger_fired`, `persist_alpha_recheck_verdict`, and
     `upsert_session_phase_performance` already exist with correct signatures
     but the client receives 404. Force PostgREST to reload its schema and
     config caches.

  ## Changes
  - Add nullable `updated_at timestamptz` to `entry_intents`
  - Default new rows via `BEFORE INSERT` initialization (mirrors `created_at`)
  - Maintain it on every row update via `BEFORE UPDATE` trigger
  - Backfill existing rows so the secondary sort produces a deterministic order
  - Issue NOTIFY pgrst, 'reload schema' / 'reload config' to flush PostgREST cache

  ## Security
  - No RLS changes; `updated_at` is server-maintained and read by existing policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'entry_intents'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.entry_intents
      ADD COLUMN updated_at timestamptz;
  END IF;
END $$;

UPDATE public.entry_intents
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.entry_intents
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.entry_intents_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entry_intents_set_updated_at ON public.entry_intents;
CREATE TRIGGER trg_entry_intents_set_updated_at
BEFORE UPDATE ON public.entry_intents
FOR EACH ROW
EXECUTE FUNCTION public.entry_intents_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_entry_intents_session_status_created_updated
  ON public.entry_intents (session_id, status, created_at DESC, updated_at DESC);

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
