/*
  # Force Schema Cache Reload for read column

  1. What This Does
    - Forces PostgREST to reload its schema cache
    - Makes the new 'read' column immediately available to the API
    
  2. Why This Is Needed
    - PostgREST caches the database schema
    - After adding new columns, the cache must be notified to refresh
    - Without this, API requests fail with "column not found" errors
*/

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';

-- Also verify the column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' 
    AND column_name = 'read'
  ) THEN
    RAISE EXCEPTION 'read column not found in goal_notifications table';
  END IF;
  
  RAISE NOTICE 'read column verified in goal_notifications table';
END $$;
