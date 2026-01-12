/*
  # Fix Continuation Notification Type

  ## Problem
  The `request_session_continuation` function tries to create a modal with type 'continuation',
  but the `valid_notification_type` constraint doesn't include this value, causing:
  "new row for relation "goal_notifications" violates check constraint "valid_notification_type""

  ## Solution
  Add 'continuation' to the list of valid notification types in the constraint.

  ## Changes
  1. Drop existing constraint
  2. Recreate with 'continuation' added to allowed types

  ## Impact
  - Fixes immediate blocker preventing trade execution
  - Allows continuation modals to be created successfully
  - No data changes, only schema validation update
*/

-- Drop existing constraint
ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

-- Recreate with 'continuation' added
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type
  CHECK (type IN (
    'signal', 'alert', 'completion', 'mid_trade_trigger',
    'goal_achieved', 'trade_closed', 'scanning_timeout',
    'wellness_check', 'session_update', 'progress',
    'session_ended', 'session_auto_closed', 'session_paused',
    'continuation_required', 'session_started', 'trade_entry',
    'entry_abandoned', 'entry_monitoring_started', 'entry_quality_improving',
    'entry_quality_ready', 'sl_triggered',
    'continuation'
  ));
