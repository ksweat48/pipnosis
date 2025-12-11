/*
  # Add Notification Priorities and Execution Urgency

  1. Updates
    - Add `priority` field to `goal_notifications` table
    - Add `execution_urgency` timestamp field for trade signal timing
    - Add `acknowledged_at` timestamp for tracking when user dismisses
    - Add indexes for faster priority-based queries

  2. Security
    - No RLS changes needed (inherits from existing policies)
*/

-- Add priority and urgency fields to goal_notifications if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'priority'
  ) THEN
    ALTER TABLE goal_notifications
    ADD COLUMN priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'execution_urgency'
  ) THEN
    ALTER TABLE goal_notifications
    ADD COLUMN execution_urgency timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'acknowledged_at'
  ) THEN
    ALTER TABLE goal_notifications
    ADD COLUMN acknowledged_at timestamptz;
  END IF;
END $$;

-- Add index for priority-based queries
CREATE INDEX IF NOT EXISTS idx_goal_notifications_priority
ON goal_notifications(user_id, priority, created_at DESC)
WHERE acknowledged_at IS NULL;

-- Add index for execution urgency queries
CREATE INDEX IF NOT EXISTS idx_goal_notifications_urgency
ON goal_notifications(user_id, execution_urgency)
WHERE acknowledged_at IS NULL AND notification_type = 'signal';

-- Create notification_preferences table for user settings
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Sound preferences
  enable_sounds boolean DEFAULT true,
  goal_achievement_sound boolean DEFAULT true,
  trade_signal_sound boolean DEFAULT true,

  -- Notification position
  notification_position text DEFAULT 'top' CHECK (notification_position IN ('top', 'bottom')),

  -- Auto-dismiss settings
  auto_dismiss_low_priority boolean DEFAULT true,
  auto_dismiss_duration_seconds integer DEFAULT 30,

  -- Do Not Disturb
  dnd_enabled boolean DEFAULT false,
  dnd_start_time time,
  dnd_end_time time,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notification_preferences
CREATE POLICY "Users can view own notification preferences"
  ON notification_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
  ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add comment for documentation
COMMENT ON TABLE notification_preferences IS 'User preferences for global notification system including sounds, position, and do-not-disturb settings';
COMMENT ON COLUMN goal_notifications.priority IS 'Notification priority: low (5min), medium (1min), high (immediate), urgent (critical)';
COMMENT ON COLUMN goal_notifications.execution_urgency IS 'Timestamp by which trade signal should be executed';
COMMENT ON COLUMN goal_notifications.acknowledged_at IS 'When user dismissed or acknowledged the notification';
