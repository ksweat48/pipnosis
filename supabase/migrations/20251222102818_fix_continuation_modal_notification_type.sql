/*
  # Fix Continuation Modal Notification Type

  1. Problem
    The `trigger_continuation_modal` function uses 'scanning_timeout' as the notification type,
    but the CHECK constraint only allows 'continuation_required'.
    
    This causes infinite 400 errors:
    "new row for relation goal_notifications violates check constraint goal_notifications_type_check"

  2. Solution
    Add 'scanning_timeout' to the valid notification types

  3. Security
    - No RLS changes
    - Only expanding valid enum values
*/

-- Drop the existing CHECK constraint
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS goal_notifications_type_check;

-- Recreate with 'scanning_timeout' included
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
    'mid_trade_action',
    'session_ended',
    'continuation_required',
    'scanning_timeout'
  ));

COMMENT ON CONSTRAINT goal_notifications_type_check ON goal_notifications IS
  'Valid notification types including scanning_timeout for 15-minute continuation modals';
