/*
  # Extended Search Sessions Table

  1. New Tables
    - `extended_search_sessions` - Tracks 1-hour extended search sessions for trade opportunities
    - Stores user prompt, search parameters, scan results, and market conditions
    - Tracks search progress, status, and completion reason

  2. Security
    - Enable RLS on extended_search_sessions table
    - Users can only access their own search sessions
    - Policies for SELECT, INSERT, UPDATE operations

  3. Notes
    - Sessions automatically expire after 1 hour
    - Tracks scan count and market conditions at each interval
    - Stores detailed reasons when no trades are found
    - Links to trade signals if opportunity is found
*/

CREATE TABLE IF NOT EXISTS extended_search_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_prompt text NOT NULL,
  search_intent text NOT NULL CHECK (search_intent IN ('find_trade', 'analyze_market', 'check_signal')),
  bias text NOT NULL CHECK (bias IN ('bullish', 'bearish', 'any')),
  symbols text[] NOT NULL,
  risk_tolerance text NOT NULL CHECK (risk_tolerance IN ('low', 'medium', 'high')),
  account_balance numeric NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'timeout')),
  scan_count integer DEFAULT 0,
  opportunities_found integer DEFAULT 0,
  last_scan_time timestamptz,
  market_conditions jsonb DEFAULT '{}',
  no_trade_reasons jsonb DEFAULT '[]',
  best_opportunity_id uuid REFERENCES strategy_signals(id) ON DELETE SET NULL,
  completion_reason text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '1 hour'),
  CONSTRAINT valid_session_duration CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_user_id ON extended_search_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_status ON extended_search_sessions(status);
CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_started_at ON extended_search_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_expires_at ON extended_search_sessions(expires_at);

ALTER TABLE extended_search_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own search sessions"
  ON extended_search_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own search sessions"
  ON extended_search_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own search sessions"
  ON extended_search_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION cleanup_expired_search_sessions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE extended_search_sessions
  SET
    status = 'timeout',
    completed_at = now(),
    completion_reason = 'Search timeout: No valid trades found within 1 hour'
  WHERE status = 'active'
    AND expires_at < now()
    AND completed_at IS NULL;
END;
$$;
