/*
  # Fix valid_notification_type Constraint - Add Missing session_ended Type

  ## Problem
  The infinite error loop is caused by the `valid_notification_type` constraint
  (NOT goal_notifications_type_check). Functions are trying to insert notifications
  with type 'session_ended' which isn't in the allowed values.

  ## Root Cause
  Previous fix updated the WRONG constraint name. There are TWO constraints:
  1. goal_notifications_type_check (we fixed this one - WRONG)
  2. valid_notification_type (the one actually causing errors - need to fix this)

  ## Solution
  Drop and recreate `valid_notification_type` constraint with ALL required types.

  ## Security
  - No RLS changes needed
  - Only modifying CHECK constraint
*/

-- Drop the CORRECT constraint this time
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS valid_notification_type;

-- Recreate with ALL required types including session_ended
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type
  CHECK (type IN (
    'forecast',
    'signal',
    'progress',
    'alert',
    'completion',
    'mid_trade_trigger',
    'mid_trade_evaluation',
    'mid_trade_action',
    'session_ended',          -- CRITICAL: This was missing - causing 400 errors
    'continuation_required'
  ));

COMMENT ON CONSTRAINT valid_notification_type ON goal_notifications IS
  'Valid notification types: forecast, signal, progress, alert, completion, mid_trade_trigger, mid_trade_evaluation, mid_trade_action, session_ended, continuation_required';
