/*
  # Add conditions_changed_at column to entry_intents

  1. Changes
    - Add `conditions_changed_at` timestamptz column to `entry_intents` table
    - This column tracks when market conditions last changed for the intent
    - Used by the entry monitoring system to detect condition updates

  2. Purpose
    - Fixes "Could not find the 'conditions_changed_at' column" error
    - Enables proper tracking of condition changes during entry monitoring
*/

-- Add conditions_changed_at column to entry_intents if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'conditions_changed_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN conditions_changed_at timestamptz;
  END IF;
END $$;
