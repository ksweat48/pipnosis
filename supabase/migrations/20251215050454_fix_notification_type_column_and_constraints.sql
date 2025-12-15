/*
  # Fix Notification System - Rename Column and Expand Types

  1. Changes
    - Rename column `notification_type` to `type` for consistency with TypeScript interfaces
    - Expand CHECK constraint to include mid-trade notification types
    - Update indexes to reference new column name

  2. New Notification Types Supported
    - Existing: 'forecast', 'signal', 'progress', 'alert', 'completion'
    - New: 'mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action'

  3. Why This Fix Is Needed
    - TypeScript interfaces use `type` field
    - Mid-trade notifications were being silently rejected by CHECK constraint
    - Realtime subscriptions couldn't read the field correctly
    - Badge counts were always zero due to query filter mismatches
*/

-- Step 1: Drop the old CHECK constraint
ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS goal_notifications_notification_type_check;

-- Step 2: Rename the column
ALTER TABLE goal_notifications RENAME COLUMN notification_type TO type;

-- Step 3: Add new CHECK constraint with expanded types
ALTER TABLE goal_notifications
ADD CONSTRAINT goal_notifications_type_check
CHECK (type IN (
  'forecast',
  'signal',
  'progress',
  'alert',
  'completion',
  'mid_trade_trigger',
  'mid_trade_evaluation',
  'mid_trade_action'
));

-- Step 4: Update any indexes that referenced the old column name
-- Drop old index if it exists
DROP INDEX IF EXISTS idx_goal_notifications_type;

-- Create new index on the renamed column
CREATE INDEX IF NOT EXISTS idx_goal_notifications_type
ON goal_notifications(user_id, type)
WHERE viewed = false;

-- Step 5: Add comment to document the change
COMMENT ON COLUMN goal_notifications.type IS 'Notification type: forecast, signal, progress, alert, completion, mid_trade_trigger, mid_trade_evaluation, mid_trade_action';
