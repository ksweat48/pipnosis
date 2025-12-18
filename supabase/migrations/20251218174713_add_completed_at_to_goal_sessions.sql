/*
  # Add completed_at column to goal_sessions

  ## Overview
  Adds the missing `completed_at` timestamp column to the goal_sessions table.
  This column is used to track when a goal session was fully completed.

  ## Changes
  1. Add `completed_at` column to goal_sessions table (TIMESTAMPTZ, nullable)
  2. Backfill existing completed sessions based on their status
  3. Add index for performance on completed sessions queries

  ## Security
  - No RLS changes needed, existing policies cover this column
*/

-- Add completed_at column to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN completed_at TIMESTAMPTZ;
    COMMENT ON COLUMN goal_sessions.completed_at IS 'Timestamp when session was fully completed (closed)';
  END IF;
END $$;

-- Backfill completed_at for existing sessions that are already completed
UPDATE goal_sessions
SET completed_at = updated_at
WHERE completed_at IS NULL
  AND status IN ('completed', 'goal_achieved', 'expired', 'user_stopped')
  AND updated_at IS NOT NULL;

-- Add index for filtering by completed sessions
CREATE INDEX IF NOT EXISTS idx_goal_sessions_completed_at
  ON goal_sessions(completed_at DESC)
  WHERE completed_at IS NOT NULL;
