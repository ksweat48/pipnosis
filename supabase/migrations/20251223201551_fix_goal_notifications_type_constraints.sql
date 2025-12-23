/*
  # Fix goal_notifications Type Constraints
  
  ## Problem
  The `goal_notifications` table has two conflicting check constraints on the `type` column:
  1. `goal_notifications_type_check` - allows limited notification types
  2. `valid_notification_type` - allows additional notification types (trade_entry, trade_closed, goal_achieved, session_started, mid_trade_alert)
  
  When code tries to insert notifications with types like 'trade_entry', 'trade_closed', 'goal_achieved', 'session_started', or 'mid_trade_alert',
  they pass one constraint but fail the other, causing errors.
  
  ## Changes
  1. Drop the old conflicting `goal_notifications_type_check` constraint
  2. Update the `valid_notification_type` constraint to include 'mid_trade_alert' which is missing but used in the code
  
  ## Security
  - No RLS changes needed
  - Existing RLS policies remain in place
*/

-- Drop the old conflicting constraint
ALTER TABLE goal_notifications 
DROP CONSTRAINT IF EXISTS goal_notifications_type_check;

-- Drop and recreate the valid constraint with all notification types
ALTER TABLE goal_notifications 
DROP CONSTRAINT IF EXISTS valid_notification_type;

-- Recreate with complete list of notification types used in the codebase
ALTER TABLE goal_notifications
ADD CONSTRAINT valid_notification_type CHECK (
  type = ANY (ARRAY[
    'forecast',
    'signal',
    'progress',
    'alert',
    'completion',
    'mid_trade_trigger',
    'mid_trade_evaluation',
    'mid_trade_action',
    'mid_trade_alert',
    'session_ended',
    'continuation_required',
    'scanning_timeout',
    'trade_entry',
    'trade_closed',
    'goal_achieved',
    'session_started'
  ]::text[])
);
