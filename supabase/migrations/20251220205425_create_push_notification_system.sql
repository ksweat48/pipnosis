/*
  # Push Notification System

  1. New Tables
    - `push_subscriptions`
      - Stores Web Push API subscription endpoints for each user device
      - Supports unlimited devices per user
      - Tracks subscription status and last usage
      - Enables push notifications even when app is closed

  2. Schema Updates
    - Extends `goal_notifications` table with push delivery tracking
    - Adds fields for push status, delivery confirmation, and error logging
    - Adds notification grouping key for collapsing similar notifications

  3. Security
    - Enable RLS on `push_subscriptions` table
    - Users can only manage their own subscriptions
    - Service role can send to all subscriptions
    - Secure storage of push endpoint credentials

  4. Features
    - Multi-device support (phone, tablet, desktop)
    - Automatic cleanup of inactive subscriptions
    - Device identification and naming
    - Delivery status tracking
    - Notification grouping support
*/

-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  device_name text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now(),
  UNIQUE(endpoint)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_is_active ON push_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for push_subscriptions
CREATE POLICY "Users can view own subscriptions"
  ON push_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
  ON push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
  ON push_subscriptions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to subscriptions"
  ON push_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Extend goal_notifications table with push delivery tracking
DO $$
BEGIN
  -- Add push_sent column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'push_sent'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN push_sent boolean DEFAULT false;
  END IF;

  -- Add push_sent_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'push_sent_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN push_sent_at timestamptz;
  END IF;

  -- Add push_delivery_status column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'push_delivery_status'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN push_delivery_status text CHECK (push_delivery_status IN ('pending', 'delivered', 'failed', 'expired'));
  END IF;

  -- Add push_error_message column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'push_error_message'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN push_error_message text;
  END IF;

  -- Add notification_group_key column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'notification_group_key'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN notification_group_key text;
  END IF;

  -- Add push_devices_sent_count column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'push_devices_sent_count'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN push_devices_sent_count integer DEFAULT 0;
  END IF;

  -- Add push_devices_delivered_count column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'push_devices_delivered_count'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN push_devices_delivered_count integer DEFAULT 0;
  END IF;
END $$;

-- Create index for notification grouping
CREATE INDEX IF NOT EXISTS idx_goal_notifications_group_key
  ON goal_notifications(notification_group_key, user_id, created_at DESC);

-- Create index for push delivery status
CREATE INDEX IF NOT EXISTS idx_goal_notifications_push_status
  ON goal_notifications(push_delivery_status, push_sent);

-- Function to clean up inactive push subscriptions (older than 90 days)
CREATE OR REPLACE FUNCTION cleanup_inactive_push_subscriptions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE push_subscriptions
  SET is_active = false
  WHERE is_active = true
    AND last_used_at < NOW() - INTERVAL '90 days';
END;
$$;

-- Function to mark subscription as inactive (called when push fails with 410 Gone)
CREATE OR REPLACE FUNCTION mark_push_subscription_inactive(subscription_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE push_subscriptions
  SET is_active = false
  WHERE endpoint = subscription_endpoint;
END;
$$;

-- Function to update subscription last_used_at
CREATE OR REPLACE FUNCTION update_push_subscription_last_used(subscription_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE push_subscriptions
  SET last_used_at = NOW()
  WHERE endpoint = subscription_endpoint;
END;
$$;

-- Function to get active subscriptions for a user
CREATE OR REPLACE FUNCTION get_active_push_subscriptions(target_user_id uuid)
RETURNS TABLE (
  id uuid,
  endpoint text,
  p256dh_key text,
  auth_key text,
  device_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.id,
    ps.endpoint,
    ps.p256dh_key,
    ps.auth_key,
    ps.device_name
  FROM push_subscriptions ps
  WHERE ps.user_id = target_user_id
    AND ps.is_active = true
  ORDER BY ps.last_used_at DESC;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION cleanup_inactive_push_subscriptions() TO service_role;
GRANT EXECUTE ON FUNCTION mark_push_subscription_inactive(text) TO service_role;
GRANT EXECUTE ON FUNCTION update_push_subscription_last_used(text) TO service_role;
GRANT EXECUTE ON FUNCTION get_active_push_subscriptions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_active_push_subscriptions(uuid) TO authenticated;
