/*
  # Fix: Stale Entry Thesis Memory Cleanup

  ## Problem
  The entry_thesis_memory table accumulates expired records with status = 'EXPIRED'
  and expires_at < NOW(). On scan startup, the in-memory cache is cleared per scan cycle
  (handled in goal-session-live-engine.ts), but the database layer can still serve stale
  expired records if the in-memory cache is cold (e.g., after a page refresh or new session).

  ## Changes

  ### 1. Delete All Currently Expired Records
  Removes all rows where expires_at < NOW() to clear the backlog of stale thesis blocks
  that may be incorrectly blocking symbols from being evaluated.

  ### 2. Create Automatic Cleanup Function
  Creates `cleanup_expired_entry_thesis_memory()` which removes records expired
  more than 30 minutes ago. Safe to call repeatedly — uses IF EXISTS guards.

  ### 3. Schedule Automated Retention Cleanup
  Registers the cleanup function to run every 30 minutes via pg_cron so the table
  stays lean and never serves stale blocks to the scan engine.

  ## Security
  - Function runs as SECURITY DEFINER with restricted search_path
  - No RLS changes required (no new tables)
  - No user data is deleted — only expired thesis records past their TTL

  ## Impact
  - Symbols blocked by stale expired thesis records will be eligible for re-evaluation
  - In-memory cache is cleared per scan in goal-session-live-engine.ts (code fix)
  - DB layer now also auto-purges, ensuring cold-start accuracy
*/

-- 1. Delete all currently expired entry_thesis_memory records (backlog cleanup)
DELETE FROM entry_thesis_memory
WHERE expires_at IS NOT NULL
  AND expires_at < NOW();

-- 2. Create a reusable cleanup function for ongoing automated retention
CREATE OR REPLACE FUNCTION cleanup_expired_entry_thesis_memory()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM entry_thesis_memory
  WHERE expires_at IS NOT NULL
    AND expires_at < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 3. Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION cleanup_expired_entry_thesis_memory() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_entry_thesis_memory() TO service_role;

-- 4. Schedule automated cleanup every 30 minutes via pg_cron (if extension available)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'cleanup-expired-thesis-memory',
      '*/30 * * * *',
      'SELECT cleanup_expired_entry_thesis_memory()'
    );
  END IF;
END $$;
