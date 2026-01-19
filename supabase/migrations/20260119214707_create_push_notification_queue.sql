/*
  # Create Push Notification Queue Table

  1. Overview
    - Creates queue table for processing push notifications asynchronously
    - Stores notifications pending delivery to user devices
    - Processed by backend edge function

  2. New Table
    - `push_notification_queue`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `subscription_id` (uuid, references push_subscriptions)
      - `title` (text, notification title)
      - `body` (text, notification message)
      - `data` (jsonb, additional metadata)
      - `priority` (text, delivery priority: low, medium, high, critical)
      - `status` (text, processing status: pending, sent, failed)
      - `attempts` (integer, delivery retry count)
      - `last_error` (text, error message if failed)
      - `created_at` (timestamptz, queue time)
      - `sent_at` (timestamptz, delivery time)

  3. Security
    - RLS enabled
    - Service role can process queue
    - Authenticated users can view own notifications

  4. Performance
    - Index on status for queue processing
    - Index on user_id for user queries
    - Index on created_at for time-based queries
*/

-- Create push_notification_queue table
CREATE TABLE IF NOT EXISTS push_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_push_notification_queue_status
  ON push_notification_queue(status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_push_notification_queue_user_id
  ON push_notification_queue(user_id);

CREATE INDEX IF NOT EXISTS idx_push_notification_queue_created_at
  ON push_notification_queue(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_notification_queue_priority
  ON push_notification_queue(priority, created_at DESC)
  WHERE status = 'pending';

-- Enable RLS
ALTER TABLE push_notification_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own push queue"
  ON push_notification_queue
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert notifications"
  ON push_notification_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update queue status"
  ON push_notification_queue
  FOR UPDATE
  TO authenticated
  USING (true);

-- Add comment for documentation
COMMENT ON TABLE push_notification_queue IS 'Queue for asynchronous push notification delivery to user devices';
