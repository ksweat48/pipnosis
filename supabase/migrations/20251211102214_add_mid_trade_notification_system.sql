/*
  # Mid-Trade Notification System
  
  1. Changes to goal_notifications table
    - Add `viewed` boolean (default false) to track if user has seen the notification
    - Add `dismissed_at` timestamp to track when user dismissed it
    - Add `priority` enum (urgent, high, medium, low) for visual styling
    - Add `trade_context` jsonb for full trade data snapshot
    - Add `recommendation_data` jsonb for LLM evaluation details
    - Add `trigger_type` text to categorize the mid-trade trigger
  
  2. Indexes
    - Index on (user_id, viewed) for badge count queries
    - Index on (goal_session_id, created_at) for history panel queries
  
  3. Security
    - RLS policies allow users to view and update their own notifications
*/

-- Add new columns to goal_notifications table
DO $$ 
BEGIN
  -- Add viewed column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'viewed'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN viewed boolean DEFAULT false;
  END IF;

  -- Add dismissed_at column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'dismissed_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN dismissed_at timestamptz;
  END IF;

  -- Add priority column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'priority'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN priority text DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low'));
  END IF;

  -- Add trade_context column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'trade_context'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN trade_context jsonb;
  END IF;

  -- Add recommendation_data column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'recommendation_data'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN recommendation_data jsonb;
  END IF;

  -- Add trigger_type column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_notifications' AND column_name = 'trigger_type'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN trigger_type text;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_goal_notifications_viewed 
ON goal_notifications(user_id, viewed) 
WHERE viewed = false;

CREATE INDEX IF NOT EXISTS idx_goal_notifications_session_time 
ON goal_notifications(goal_session_id, created_at DESC);

-- Update RLS policies to allow users to update their own notifications
DROP POLICY IF EXISTS "Users can update own notifications" ON goal_notifications;

CREATE POLICY "Users can update own notifications"
ON goal_notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);