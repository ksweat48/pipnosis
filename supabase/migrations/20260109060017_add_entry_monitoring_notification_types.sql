/*
  # Add Entry Monitoring Notification Types

  1. Purpose
    - Document new notification types for entry monitoring system
    - Ensure constraint validation includes new types

  2. New Notification Types
    - `entry_monitoring_started` - When entry monitor begins watching for optimal entry
    - `entry_quality_improving` - When EQS score crosses meaningful thresholds
    - `entry_quality_ready` - When EQS reaches execution threshold
    - `entry_abandoned` - When entry monitoring times out or is cancelled

  3. Changes
    - Update notification type constraint to include new entry monitoring types
    - Preserve all existing notification types
*/

-- Update the notification type constraint to include entry monitoring types
DO $$
BEGIN
  -- Drop existing constraint if it exists
  ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

  -- Add new constraint with ALL notification types (existing + new entry monitoring)
  ALTER TABLE goal_notifications ADD CONSTRAINT valid_notification_type
    CHECK (type IN (
      -- Existing types from database
      'alert',
      'completion',
      'progress',
      'scanning_timeout',
      'session_ended',
      'session_paused',
      'session_started',
      'signal',
      'sl_triggered',
      'trade_closed',
      'trade_entry',
      -- Standard types from schema
      'goal_achieved',
      'goal_failed',
      'goal_progress',
      'trade_signal',
      'session_timeout',
      'continuation_modal',
      'mid_trade_alert',
      'tp1_hit',
      'tp2_hit',
      'sl_warning',
      'general',
      -- NEW: Entry monitoring types
      'entry_monitoring_started',
      'entry_quality_improving',
      'entry_quality_ready',
      'entry_abandoned'
    ));

  RAISE NOTICE 'Added entry monitoring notification types to constraint';
END $$;

-- Create index for entry monitoring notifications for faster queries
CREATE INDEX IF NOT EXISTS idx_goal_notifications_entry_monitoring
  ON goal_notifications(user_id, type, created_at DESC)
  WHERE type IN ('entry_monitoring_started', 'entry_quality_improving', 'entry_quality_ready', 'entry_abandoned');

COMMENT ON INDEX idx_goal_notifications_entry_monitoring IS
  'Performance index for entry monitoring notification queries';
