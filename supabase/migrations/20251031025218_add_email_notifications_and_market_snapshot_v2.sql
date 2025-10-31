/*
  # Add Email Notifications and Enhanced Market Tracking

  ## New Features
  1. Email notification preferences for users
  2. Email delivery tracking
  3. Enhanced market snapshot data in AI conversations
  4. Rate limiting for email notifications

  ## Changes
  
  ### user_profiles table
  - Add `email_notifications_enabled` (boolean) - Master toggle for email notifications
  - Add `email_notification_preferences` (jsonb) - Granular control over notification types
  
  ### goal_notifications table
  - Add `email_sent` (boolean) - Track if email was sent
  - Add `email_sent_at` (timestamptz) - When email was sent
  - Add `email_status` (text) - Status of email delivery
  - Add `email_error` (text) - Error message if email failed
  
  ### goal_ai_conversations table
  - Add `market_snapshot` (jsonb) - Current market conditions at time of message
  - Add `technical_data` (jsonb) - Detailed technical analysis data
  
  ### New table: email_notification_log
  - Track all email notifications sent
  - Enable auditing and rate limiting
*/

-- Add email notification columns to user_profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'email_notifications_enabled'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN email_notifications_enabled boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'email_notification_preferences'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN email_notification_preferences jsonb DEFAULT '{
      "trade_signals": true,
      "goal_progress": true,
      "goal_completion": true,
      "session_start": false,
      "high_confidence_only": true,
      "min_confidence": 75
    }'::jsonb;
  END IF;
END $$;

-- Add email tracking columns to goal_notifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'email_sent'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN email_sent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'email_sent_at'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN email_sent_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'email_status'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN email_status text DEFAULT 'pending' CHECK (email_status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications' AND column_name = 'email_error'
  ) THEN
    ALTER TABLE goal_notifications ADD COLUMN email_error text;
  END IF;
END $$;

-- Add market snapshot columns to goal_ai_conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_ai_conversations' AND column_name = 'market_snapshot'
  ) THEN
    ALTER TABLE goal_ai_conversations ADD COLUMN market_snapshot jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_ai_conversations' AND column_name = 'technical_data'
  ) THEN
    ALTER TABLE goal_ai_conversations ADD COLUMN technical_data jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Create email_notification_log table
CREATE TABLE IF NOT EXISTS email_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES goal_notifications(id) ON DELETE SET NULL,
  email_type text NOT NULL CHECK (email_type IN ('trade_signal', 'goal_progress', 'goal_completion', 'session_start', 'alert')),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  delivery_status text DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'failed', 'bounced', 'delivered')),
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for email_notification_log
CREATE INDEX IF NOT EXISTS idx_email_log_user_sent_at ON email_notification_log(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_session ON email_notification_log(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_email_log_recent ON email_notification_log(user_id, sent_at);

-- Enable RLS for email_notification_log
ALTER TABLE email_notification_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for email_notification_log
CREATE POLICY "Users can view own email logs"
  ON email_notification_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can create email logs"
  ON email_notification_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create function to check email rate limit
CREATE OR REPLACE FUNCTION check_email_rate_limit(
  p_user_id uuid,
  p_hours integer DEFAULT 1,
  p_max_emails integer DEFAULT 5
)
RETURNS boolean AS $$
DECLARE
  email_count integer;
BEGIN
  SELECT COUNT(*) INTO email_count
  FROM email_notification_log
  WHERE user_id = p_user_id
    AND sent_at > (now() - (p_hours || ' hours')::interval);
  
  RETURN email_count < p_max_emails;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get user email notification settings
CREATE OR REPLACE FUNCTION get_user_email_settings(p_user_id uuid)
RETURNS TABLE(
  email text,
  notifications_enabled boolean,
  preferences jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.email,
    up.email_notifications_enabled,
    up.email_notification_preferences
  FROM user_profiles up
  WHERE up.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_email_rate_limit(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_email_settings(uuid) TO authenticated;

-- Add comment explaining the schema
COMMENT ON TABLE email_notification_log IS 'Tracks all email notifications sent to users for auditing and rate limiting';
COMMENT ON COLUMN user_profiles.email_notifications_enabled IS 'Master toggle for all email notifications';
COMMENT ON COLUMN user_profiles.email_notification_preferences IS 'Granular preferences for different notification types';
COMMENT ON COLUMN goal_notifications.email_sent IS 'Whether an email was sent for this notification';
COMMENT ON COLUMN goal_ai_conversations.market_snapshot IS 'Market conditions (price, trend, volatility) at time of message';
COMMENT ON COLUMN goal_ai_conversations.technical_data IS 'Detailed technical indicators (EMA, VWAP, ATR, etc)';
