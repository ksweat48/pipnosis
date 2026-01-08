/*
  # Force Schema Cache Reload for goal_session_id Column

  1. What This Fixes
    - PostgREST schema cache was looking for 'session_id' column
    - Actual column name in goal_notifications is 'goal_session_id'
    - This mismatch was causing PGRST204 "column not found" errors

  2. Why This Is Needed
    - Code was incorrectly using 'session_id' instead of 'goal_session_id'
    - PostgREST cached schema didn't reflect the actual column name
    - Forces schema cache to reload with correct column information

  3. Related Fix
    - notification-coordinator.ts updated to use 'goal_session_id'
    - This migration ensures PostgREST recognizes the correct column
*/

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';

-- Verify the goal_session_id column exists (not session_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'goal_notifications'
    AND column_name = 'goal_session_id'
  ) THEN
    RAISE EXCEPTION 'goal_session_id column not found in goal_notifications table';
  END IF;

  -- Also verify that session_id does NOT exist (should not be there)
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'goal_notifications'
    AND column_name = 'session_id'
  ) THEN
    RAISE WARNING 'Found unexpected session_id column in goal_notifications - should be goal_session_id';
  END IF;

  RAISE NOTICE '✅ Schema verified: goal_session_id column exists, schema cache reloaded';
END $$;
