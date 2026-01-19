/*
  # Credit Validation System

  1. Schema Changes
    - Add `credit_blocked` to `goal_sessions` - Indicates if session is blocked due to failed credit deduction
    - Add `pending_credit_intent_id` to `goal_sessions` - Tracks which signal's credit deduction failed
    - Add `pending_credit_metadata` to `goal_sessions` - Stores metadata about the failed deduction

  2. New Tables
    - `credit_deduction_history` - Tracks all credit deductions for signals
      - `id` (uuid, primary key)
      - `session_id` (uuid, foreign key to goal_sessions)
      - `intent_id` (uuid, foreign key to entry_intents)
      - `amount` (numeric) - Amount deducted (typically 10)
      - `status` (text) - 'success' or 'failed'
      - `timestamp` (timestamptz)
      - `retry_count` (integer) - Number of retry attempts

  3. Security
    - Enable RLS on `credit_deduction_history` table
    - Add policies for authenticated users to read their own deduction history
*/

-- Add credit blocking fields to goal_sessions
ALTER TABLE goal_sessions
ADD COLUMN IF NOT EXISTS credit_blocked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS pending_credit_intent_id uuid,
ADD COLUMN IF NOT EXISTS pending_credit_metadata jsonb;

-- Create credit deduction history table
CREATE TABLE IF NOT EXISTS credit_deduction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  intent_id uuid REFERENCES entry_intents(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 10,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
  timestamp timestamptz NOT NULL DEFAULT now(),
  retry_count integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_credit_deduction_history_session
  ON credit_deduction_history(session_id);
CREATE INDEX IF NOT EXISTS idx_credit_deduction_history_user
  ON credit_deduction_history(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_deduction_history_status
  ON credit_deduction_history(status);
CREATE INDEX IF NOT EXISTS idx_credit_deduction_history_timestamp
  ON credit_deduction_history(timestamp DESC);

-- Enable RLS
ALTER TABLE credit_deduction_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view their own deduction history
CREATE POLICY "Users can view own deduction history"
  ON credit_deduction_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can insert deduction records
CREATE POLICY "Service role can insert deduction records"
  ON credit_deduction_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create function to check if session is credit blocked
CREATE OR REPLACE FUNCTION is_session_credit_blocked(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_blocked boolean;
BEGIN
  SELECT credit_blocked INTO v_blocked
  FROM goal_sessions
  WHERE id = p_session_id;

  RETURN COALESCE(v_blocked, false);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_session_credit_blocked TO authenticated;

-- Create function to get pending credit deduction info
CREATE OR REPLACE FUNCTION get_pending_credit_deduction(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'intent_id', pending_credit_intent_id,
    'metadata', pending_credit_metadata,
    'blocked', credit_blocked
  ) INTO v_result
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_pending_credit_deduction TO authenticated;

-- Comment on table
COMMENT ON TABLE credit_deduction_history IS 'Tracks all credit deductions for trading signals. Each signal costs 10 credits.';
COMMENT ON COLUMN goal_sessions.credit_blocked IS 'True if session is blocked due to failed credit deduction. Next signal cannot be processed until credits are resolved.';
COMMENT ON COLUMN goal_sessions.pending_credit_intent_id IS 'ID of the signal/intent whose credit deduction failed, blocking the session.';
