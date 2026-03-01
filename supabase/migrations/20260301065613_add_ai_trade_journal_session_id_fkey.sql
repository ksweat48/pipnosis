/*
  # Add Foreign Key: ai_trade_journal.session_id -> goal_sessions.id

  ## Problem
  The getJournalEntries query uses a named FK hint:
    goal_sessions!ai_trade_journal_session_id_fkey
  
  This FK was never created, causing PostgREST to return PGRST200 (400 Bad Request)
  for every journal fetch, resulting in an empty journal page despite 156+ entries
  existing in the database.

  ## Changes
  - Adds FK constraint from ai_trade_journal.session_id to goal_sessions.id
  - Uses ON DELETE SET NULL to preserve journal entries if a session is deleted
  - Uses IF NOT EXISTS pattern via DO block to be idempotent

  ## Safety
  - Non-destructive: only adds a constraint, no data changes
  - SET NULL on delete ensures zero data loss
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_trade_journal_session_id_fkey'
  ) THEN
    ALTER TABLE ai_trade_journal
      ADD CONSTRAINT ai_trade_journal_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES goal_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;
