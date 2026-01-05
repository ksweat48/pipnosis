/*
  # Fix Goal Notifications - Add read column

  1. Changes
    - Add `read` column as an alias/replacement for `viewed`
    - Add `read_at` column for tracking when notification was read
    - Update existing notifications to sync viewed -> read

  2. Why This Fix Is Needed
    - Code uses `read` column but database has `viewed`
    - This causes "Could not find the 'read' column" errors
    - Notifications cannot be created or marked as read

  3. Security
    - Maintain existing RLS policies
    - Add proper indexes for performance
*/

-- Add read column (boolean, default false)
ALTER TABLE goal_notifications
  ADD COLUMN IF NOT EXISTS read boolean DEFAULT false;

-- Add read_at column for tracking when notification was read  
ALTER TABLE goal_notifications
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Sync existing viewed data to read column
UPDATE goal_notifications
SET read = viewed
WHERE viewed IS NOT NULL;

-- Add index for performance (commonly queried by user_id and read status)
CREATE INDEX IF NOT EXISTS idx_goal_notifications_user_read 
  ON goal_notifications(user_id, read) 
  WHERE read = false;

-- Add comment
COMMENT ON COLUMN goal_notifications.read IS 
  'Whether the notification has been read by the user';
  
COMMENT ON COLUMN goal_notifications.read_at IS 
  'Timestamp when the notification was marked as read';
