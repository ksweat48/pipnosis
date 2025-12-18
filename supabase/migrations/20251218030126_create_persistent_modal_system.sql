/*
  # Create Persistent Modal Queue System

  1. New Tables
    - `pending_user_modals`
      - Stores modal state when trade closes
      - Persists until user interacts
      - Checked on every app load

  2. Purpose
    - Ensures users never miss important decisions (SL hit, TP hit, goal achieved)
    - Modals persist even if browser was closed/hidden during trade closure
    - Sequential display if multiple modals pending

  3. Security
    - Enable RLS
    - Users can only see their own modals
    - Service role can insert modals (position monitor)
*/

-- Create pending_user_modals table
CREATE TABLE IF NOT EXISTS pending_user_modals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id UUID REFERENCES goal_sessions(id) ON DELETE CASCADE,
  modal_type TEXT NOT NULL,
  modal_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  dismissed_at TIMESTAMPTZ,
  user_action TEXT,

  -- Constraints
  CONSTRAINT valid_modal_type CHECK (modal_type IN ('trade_closed', 'goal_achieved', 'session_update'))
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_pending_modals_user_id
  ON pending_user_modals(user_id);

CREATE INDEX IF NOT EXISTS idx_pending_modals_undismissed
  ON pending_user_modals(user_id, dismissed_at)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_modals_session
  ON pending_user_modals(goal_session_id)
  WHERE dismissed_at IS NULL;

-- Enable Row Level Security
ALTER TABLE pending_user_modals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own pending modals"
  ON pending_user_modals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert pending modals"
  ON pending_user_modals FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert their own modals"
  ON pending_user_modals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pending modals"
  ON pending_user_modals FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pending modals"
  ON pending_user_modals FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to clean up expired modals (run via cron or manually)
CREATE OR REPLACE FUNCTION cleanup_expired_pending_modals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM pending_user_modals
  WHERE expires_at < NOW()
    AND dismissed_at IS NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

-- Function to get pending modal count for a user
CREATE OR REPLACE FUNCTION get_pending_modal_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  modal_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO modal_count
  FROM pending_user_modals
  WHERE user_id = p_user_id
    AND dismissed_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW());

  RETURN modal_count;
END;
$$;

COMMENT ON TABLE pending_user_modals IS 'Stores persistent modal dialogs that must be shown to users even if they were away during the triggering event';
COMMENT ON COLUMN pending_user_modals.modal_type IS 'Type of modal: trade_closed, goal_achieved, session_update';
COMMENT ON COLUMN pending_user_modals.modal_data IS 'Complete data needed to render the modal (symbol, prices, P&L, etc)';
COMMENT ON COLUMN pending_user_modals.expires_at IS 'Modal expires after 7 days - session auto-closes if no interaction';
COMMENT ON COLUMN pending_user_modals.dismissed_at IS 'Timestamp when user interacted with modal';
COMMENT ON COLUMN pending_user_modals.user_action IS 'Action user took: continue, close, acknowledged';
