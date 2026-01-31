/*
  # Fix Missing scanning_started_at Column

  ## Issue
  Goal session creation fails with "Could not find the 'scanning_started_at' column"
  The smart-goal-session-manager tries to insert this column but it was never created

  ## Solution
  Add the scanning_started_at column to goal_sessions table
  Set it to track when the user initiated the scanning session
  Backfill existing sessions with created_at timestamp

  ## Changes
  1. Add scanning_started_at TIMESTAMPTZ column
  2. Backfill with created_at for existing sessions
  3. Add documentation comment
*/

-- Add the missing column if it doesn't exist
ALTER TABLE goal_sessions
ADD COLUMN IF NOT EXISTS scanning_started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- Backfill existing sessions with their created_at timestamp
UPDATE goal_sessions
SET scanning_started_at = COALESCE(created_at, NOW())
WHERE scanning_started_at = NOW() AND created_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN goal_sessions.scanning_started_at IS 'Timestamp when the user initiated the scanning session. Used to track session lifespan and trigger continuation modals.';
