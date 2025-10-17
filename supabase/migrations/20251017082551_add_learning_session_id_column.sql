/*
  # Add Learning Session ID Column

  1. Purpose
    - Add learning_session_id column for tracking continuous learning sessions
    - This column is referenced in the auto trading code but was missing from schema

  2. Changes
    - Add learning_session_id column with default UUID generation

  3. Security
    - Existing RLS policies will apply to this new column
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_trading_status' AND column_name = 'learning_session_id'
  ) THEN
    ALTER TABLE auto_trading_status
    ADD COLUMN learning_session_id uuid DEFAULT gen_random_uuid();
  END IF;
END $$;

COMMENT ON COLUMN auto_trading_status.learning_session_id IS 'Unique ID for continuous learning session tracking';
