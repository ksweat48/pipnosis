/*
  # Create Polling Orchestrator Error Tracking (SSOT)

  1. New Tables
    - `polling_orchestrator_errors`
      - `id` (uuid, primary key)
      - `timestamp` (timestamptz, auto-generated)
      - `error_type` (text: coordinator_init, failover, recovery, strategy_lookup)
      - `error_message` (text)
      - `symbol` (text, nullable - which symbol caused the error)
      - `session_id` (uuid, nullable - which session context)
      - `recovery_action` (text, nullable - what action was taken)
      - `stack_trace` (text, nullable - for debugging)
      - `resolved_at` (timestamptz, nullable - when issue was resolved)

  2. Security
    - Enable RLS on table
    - Service role can insert/select for diagnostics
    - Users can only see their own session errors

  3. Indexes
    - Index on timestamp for time-range queries
    - Index on error_type for filtering by error class
    - Index on session_id for user diagnostics

  4. Purpose
    - Single source of truth for polling system failures
    - Enables CCIP compliance tracking of all state changes
    - Supports root cause analysis and trend detection
*/

CREATE TABLE IF NOT EXISTS polling_orchestrator_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  error_type text NOT NULL CHECK (error_type IN ('coordinator_init', 'failover', 'recovery', 'strategy_lookup', 'price_fetch')),
  error_message text NOT NULL,
  symbol text,
  session_id uuid,
  recovery_action text,
  stack_trace text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE polling_orchestrator_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert polling errors"
  ON polling_orchestrator_errors
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can view all polling errors"
  ON polling_orchestrator_errors
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Users can view their own session errors"
  ON polling_orchestrator_errors
  FOR SELECT
  TO authenticated
  USING (session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM goal_sessions
    WHERE goal_sessions.id = polling_orchestrator_errors.session_id
    AND goal_sessions.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_polling_errors_timestamp ON polling_orchestrator_errors(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_polling_errors_type ON polling_orchestrator_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_polling_errors_session ON polling_orchestrator_errors(session_id);
CREATE INDEX IF NOT EXISTS idx_polling_errors_symbol ON polling_orchestrator_errors(symbol);

GRANT INSERT, SELECT ON polling_orchestrator_errors TO service_role;
