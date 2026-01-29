/*
  # Add Unique Constraint for Session Intelligence Data

  1. Changes
    - Add unique constraint on session_name to enable upsert operations
    - This allows the edge function to reliably update session data

  2. Technical Details
    - Constraint name: session_intelligence_data_session_name_unique
    - Ensures only one record per session name at any time
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
    AND table_name = 'session_intelligence_data'
    AND constraint_name = 'session_intelligence_data_session_name_unique'
  ) THEN
    ALTER TABLE session_intelligence_data 
    ADD CONSTRAINT session_intelligence_data_session_name_unique 
    UNIQUE (session_name);
  END IF;
END $$;