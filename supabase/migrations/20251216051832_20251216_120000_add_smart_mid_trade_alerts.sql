/*
  # Smart Mid-Trade Alert System Enhancement

  1. New Columns Added to goal_notifications
    - `requires_user_alert` (boolean) - TRUE for critical actions (EXIT_IMMEDIATELY, TAKE_PROFIT_EARLY)
    - `auto_execute_at` (timestamptz) - When system will auto-execute (30 seconds from creation)
    - `user_responded` (boolean) - Tracks if user manually acknowledged the popup
    - `acknowledged_at` (timestamptz) - When user clicked acknowledge button
    - `executed` (boolean) - Tracks if recommendation was executed (prevents duplicates)
    - `executed_at` (timestamptz) - When the recommendation was executed

  2. Logic
    - Non-critical actions (HOLD, MOVE_SL, MOVE_TP): requires_user_alert = false, executed immediately
    - Critical actions (EXIT_IMMEDIATELY, TAKE_PROFIT_EARLY): requires_user_alert = true, shown with popup + countdown
    - All critical actions auto-execute after 30 seconds regardless of user interaction
    - User can acknowledge to dismiss popup but execution still happens

  3. Indexes
    - Index on (requires_user_alert, auto_execute_at, executed) for auto-execution query
    - Index on (user_id, requires_user_alert, executed) for active alerts query

  4. Security
    - Existing RLS policies apply - users can only see their own notifications
*/

-- Add new columns to goal_notifications table
DO $$
BEGIN
  -- Add requires_user_alert column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'requires_user_alert'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN requires_user_alert boolean DEFAULT false;
  END IF;

  -- Add auto_execute_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'auto_execute_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN auto_execute_at timestamptz;
  END IF;

  -- Add user_responded column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'user_responded'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN user_responded boolean DEFAULT false;
  END IF;

  -- Add acknowledged_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'acknowledged_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN acknowledged_at timestamptz;
  END IF;

  -- Add executed column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'executed'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN executed boolean DEFAULT false;
  END IF;

  -- Add executed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'executed_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN executed_at timestamptz;
  END IF;
END $$;

-- Create indexes for auto-execution queries
CREATE INDEX IF NOT EXISTS idx_goal_notifications_auto_execute
ON goal_notifications(requires_user_alert, auto_execute_at, executed)
WHERE requires_user_alert = true AND executed = false;

CREATE INDEX IF NOT EXISTS idx_goal_notifications_active_alerts
ON goal_notifications(user_id, requires_user_alert, executed)
WHERE requires_user_alert = true AND executed = false;

-- Comment on columns for clarity
COMMENT ON COLUMN goal_notifications.requires_user_alert IS 'TRUE for critical actions that need popup alert (EXIT_IMMEDIATELY, TAKE_PROFIT_EARLY)';
COMMENT ON COLUMN goal_notifications.auto_execute_at IS 'Timestamp when system will auto-execute recommendation (30 seconds from creation)';
COMMENT ON COLUMN goal_notifications.user_responded IS 'TRUE if user manually acknowledged the popup modal';
COMMENT ON COLUMN goal_notifications.acknowledged_at IS 'Timestamp when user clicked acknowledge button';
COMMENT ON COLUMN goal_notifications.executed IS 'TRUE if recommendation was executed (prevents duplicate execution)';
COMMENT ON COLUMN goal_notifications.executed_at IS 'Timestamp when recommendation was executed by system';