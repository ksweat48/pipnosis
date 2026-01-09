/*
  # Add Entry Intent Heartbeat Tracking

  ## Changes
  1. Add `last_checked_at` column to `entry_intents` table
     - Tracks when monitoring last checked this intent
     - Used for health monitoring and debugging
     - Helps detect silent monitoring failures

  2. Security
     - No RLS changes needed (inherits from table)
*/

-- Add last_checked_at column for heartbeat tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'last_checked_at'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN last_checked_at timestamptz;

    -- Create index for efficient queries
    CREATE INDEX IF NOT EXISTS idx_entry_intents_last_checked
    ON entry_intents(last_checked_at)
    WHERE status = 'monitoring';
  END IF;
END $$;
