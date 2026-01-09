/*
  # Cleanup Orphaned Entry Intents

  1. Purpose
    - Cancel entry intents with invalid session references
    - Cancel monitoring intents for ended sessions

  2. Safety
    - Only affects intents in 'monitoring' status
    - Does not delete data, only updates status to 'canceled'
*/

-- Cancel intents where session doesn't exist
UPDATE entry_intents
SET status = 'canceled',
    canceled_at = now(),
    canceled_reason = 'Session no longer exists'
WHERE status = 'monitoring'
  AND NOT EXISTS (
    SELECT 1 FROM goal_sessions gs
    WHERE gs.id = entry_intents.session_id
  );

-- Cancel intents for sessions that are no longer active
UPDATE entry_intents
SET status = 'canceled',
    canceled_at = now(),
    canceled_reason = 'Session ended or timed out'
WHERE status = 'monitoring'
  AND EXISTS (
    SELECT 1 FROM goal_sessions gs
    WHERE gs.id = entry_intents.session_id
    AND gs.status != 'active'
  );

-- Ensure session_id has proper FK constraint with cascade
DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entry_intents_session_id_fkey'
  ) THEN
    ALTER TABLE entry_intents DROP CONSTRAINT entry_intents_session_id_fkey;
  END IF;

  -- Add new constraint with cascade delete
  ALTER TABLE entry_intents
  ADD CONSTRAINT entry_intents_session_id_fkey
  FOREIGN KEY (session_id)
  REFERENCES goal_sessions(id)
  ON DELETE CASCADE;
END $$;

-- Add comment
COMMENT ON COLUMN entry_intents.session_id IS
'FK to goal_sessions - cascades delete when session is removed';