/*
  # Create User Feedback System

  ## Overview
  Comprehensive feedback tracking system for beta users to submit feedback, suggestions, and bug reports.
  Admins receive email notifications and can manage feedback through dedicated interface.

  ## Tables Created
  
  ### 1. user_feedback
  Main feedback submissions table
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users)
  - `user_email` (text) - cached for display
  - `feedback_type` (text) - bug, improvement, feature_request, general
  - `subject` (text) - short title (5-100 chars)
  - `message` (text) - main content (20-1000 chars)
  - `status` (text) - new, reviewing, resolved
  - `priority` (text) - low, medium, high
  - `admin_notes` (text) - internal notes
  - `admin_user_id` (uuid) - who handled it
  - `user_notified` (boolean) - notification sent
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
  - `resolved_at` (timestamptz)

  ### 2. user_feedback_replies
  Conversation thread between users and admins
  - `id` (uuid, primary key)
  - `feedback_id` (uuid, references user_feedback)
  - `user_id` (uuid, references auth.users)
  - `message` (text)
  - `is_admin` (boolean)
  - `created_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Users can insert their own feedback and view their own submissions
  - Admins can view all feedback, update status, and add replies
  - Rate limiting: 10 submissions per day per user

  ## Indexes
  - user_id, status, created_at for performance
  - feedback_id for replies lookup
*/

-- Create user_feedback table
CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_email text NOT NULL,
  feedback_type text NOT NULL CHECK (feedback_type IN ('bug', 'improvement', 'feature_request', 'general')),
  subject text NOT NULL CHECK (char_length(subject) >= 5 AND char_length(subject) <= 100),
  message text NOT NULL CHECK (char_length(message) >= 20 AND char_length(message) <= 1000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  admin_notes text,
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_notified boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  resolved_at timestamptz
);

-- Create user_feedback_replies table
CREATE TABLE IF NOT EXISTS user_feedback_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid REFERENCES user_feedback(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  message text NOT NULL CHECK (char_length(message) >= 1 AND char_length(message) <= 1000),
  is_admin boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback(status);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_type ON user_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_user_feedback_replies_feedback_id ON user_feedback_replies(feedback_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_replies_created_at ON user_feedback_replies(created_at);

-- Enable RLS
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback_replies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_feedback

-- Users can insert their own feedback
CREATE POLICY "Users can insert own feedback"
  ON user_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback"
  ON user_feedback
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all feedback
CREATE POLICY "Admins can view all feedback"
  ON user_feedback
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admins can update feedback
CREATE POLICY "Admins can update feedback"
  ON user_feedback
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- RLS Policies for user_feedback_replies

-- Users can view replies to their feedback
CREATE POLICY "Users can view replies to own feedback"
  ON user_feedback_replies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_feedback
      WHERE user_feedback.id = user_feedback_replies.feedback_id
      AND user_feedback.user_id = auth.uid()
    )
  );

-- Admins can view all replies
CREATE POLICY "Admins can view all replies"
  ON user_feedback_replies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Admins can insert replies
CREATE POLICY "Admins can insert replies"
  ON user_feedback_replies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
    AND is_admin = true
  );

-- Users can insert replies to their own feedback
CREATE POLICY "Users can reply to own feedback"
  ON user_feedback_replies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_feedback
      WHERE user_feedback.id = user_feedback_replies.feedback_id
      AND user_feedback.user_id = auth.uid()
    )
    AND auth.uid() = user_id
    AND is_admin = false
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_user_feedback_updated_at_trigger ON user_feedback;
CREATE TRIGGER update_user_feedback_updated_at_trigger
  BEFORE UPDATE ON user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_user_feedback_updated_at();

-- Function to set resolved_at when status changes to resolved
CREATE OR REPLACE FUNCTION set_feedback_resolved_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status != 'resolved' THEN
    NEW.resolved_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-set resolved_at
DROP TRIGGER IF EXISTS set_feedback_resolved_at_trigger ON user_feedback;
CREATE TRIGGER set_feedback_resolved_at_trigger
  BEFORE UPDATE ON user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION set_feedback_resolved_at();

-- Function to check rate limit (10 submissions per day)
CREATE OR REPLACE FUNCTION check_feedback_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  submission_count integer;
BEGIN
  SELECT COUNT(*) INTO submission_count
  FROM user_feedback
  WHERE user_id = NEW.user_id
  AND created_at > now() - interval '24 hours';
  
  IF submission_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded: Maximum 10 feedback submissions per 24 hours';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce rate limit
DROP TRIGGER IF EXISTS check_feedback_rate_limit_trigger ON user_feedback;
CREATE TRIGGER check_feedback_rate_limit_trigger
  BEFORE INSERT ON user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION check_feedback_rate_limit();

-- Enable realtime for feedback tables
ALTER PUBLICATION supabase_realtime ADD TABLE user_feedback;
ALTER PUBLICATION supabase_realtime ADD TABLE user_feedback_replies;