/*
  # Fix Notification Type Constraint - Add Missing Types

  1. Problem
    The `create_session_ended_modal` and `trigger_continuation_modal` functions
    are trying to insert notifications with types that aren't in the CHECK constraint:

    - 'session_ended' (used when sessions timeout or close)
    - 'continuation_required' (used when 15-min modal is triggered)

    This causes 400 errors in an infinite loop:
    "new row for relation goal_notifications violates check constraint goal_notifications_type_check"

  2. Solution
    Add the missing notification types to the CHECK constraint

  3. Security
    - No RLS changes needed
    - Only expanding valid enum values
*/

-- Drop the old CHECK constraint
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS goal_notifications_type_check;

-- Add new CHECK constraint with ALL required types
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
    'continuation_required'
  ));

-- Update comment to document all valid types
COMMENT ON CONSTRAINT goal_notifications_type_check ON goal_notifications IS
  'Valid notification types: forecast, signal, progress, alert, completion, mid_trade_trigger, mid_trade_evaluation, mid_trade_action, session_ended, continuation_required';
