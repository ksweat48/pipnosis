/*
  # Fix Goal Notifications - Make goal_session_id Nullable

  1. Changes
    - Make goal_session_id column nullable to support notifications outside goal sessions
    - Update constraint to allow null values

  2. Why This Fix Is Needed
    - Some notifications (like manual trade entries) may not be part of a goal session
    - Frontend was trying to insert notifications with null goal_session_id
    - This was causing 400 errors: "null value in column goal_session_id violates not-null constraint"

  3. Impact
    - Allows notifications to be created for both goal sessions and standalone trades
    - No data loss - existing notifications remain unchanged
*/

-- Make goal_session_id nullable
ALTER TABLE goal_notifications
  ALTER COLUMN goal_session_id DROP NOT NULL;

COMMENT ON COLUMN goal_notifications.goal_session_id IS
  'Optional: goal session ID if notification is related to a goal session';
