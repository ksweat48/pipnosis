/*
  # Entry Execution Audit System - CCIP Compliant

  ## Purpose
  Track every step of entry intent execution to diagnose "EXECUTE_READY" → execution failure gaps.

  ## Tables
  1. `entry_execution_audit` - Step-by-step execution tracking

  ## Security
  - Service role only (execution happens server-side)
  - Users can read their own audit logs

  ## SSOT Principle
  This is the SINGLE SOURCE OF TRUTH for execution step outcomes.
  Alpha can query this to understand why executions fail and adapt.
*/

-- Create execution audit table
CREATE TABLE IF NOT EXISTS entry_execution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES entry_intents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,

  -- Execution attempt tracking
  attempt_number integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- Step tracking
  current_step text NOT NULL,
  step_sequence jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Outcome
  success boolean,
  failure_step text,
  failure_reason text,
  error_details jsonb,

  -- Execution context
  entry_price numeric(20, 10),
  eqs_score integer,
  urgency_phase integer,
  zone_tolerance_pips integer,

  -- Performance metrics
  duration_ms integer,

  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_phase CHECK (urgency_phase IN (1, 2, 3)),
  CONSTRAINT valid_step CHECK (current_step IN (
    'STARTED',
    'FETCH_INTENT',
    'VALIDATE_CONTEXT',
    'CALCULATE_POSITION',
    'INSERT_TRADE',
    'UPDATE_INTENT',
    'TRANSITION_SESSION',
    'CREATE_NOTIFICATION',
    'COMPLETED',
    'FAILED'
  ))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_execution_audit_intent ON entry_execution_audit(intent_id);
CREATE INDEX IF NOT EXISTS idx_execution_audit_user ON entry_execution_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_audit_session ON entry_execution_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_execution_audit_outcome ON entry_execution_audit(success, failure_step) WHERE success = false;
CREATE INDEX IF NOT EXISTS idx_execution_audit_recent ON entry_execution_audit(started_at DESC);

-- Enable RLS
ALTER TABLE entry_execution_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Service role full access"
  ON entry_execution_audit
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view own execution audits"
  ON entry_execution_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Helper function: Start execution audit
CREATE OR REPLACE FUNCTION start_execution_audit(
  p_intent_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_entry_price numeric,
  p_eqs_score integer,
  p_urgency_phase integer,
  p_zone_tolerance_pips integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_audit_id uuid;
  v_attempt_number integer;
BEGIN
  -- Get next attempt number
  SELECT COALESCE(MAX(attempt_number), 0) + 1
  INTO v_attempt_number
  FROM entry_execution_audit
  WHERE intent_id = p_intent_id;

  -- Create audit record
  INSERT INTO entry_execution_audit (
    intent_id,
    user_id,
    session_id,
    attempt_number,
    current_step,
    step_sequence,
    entry_price,
    eqs_score,
    urgency_phase,
    zone_tolerance_pips
  ) VALUES (
    p_intent_id,
    p_user_id,
    p_session_id,
    v_attempt_number,
    'STARTED',
    jsonb_build_array(
      jsonb_build_object(
        'step', 'STARTED',
        'timestamp', now(),
        'duration_ms', 0
      )
    ),
    p_entry_price,
    p_eqs_score,
    p_urgency_phase,
    p_zone_tolerance_pips
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

-- Helper function: Log execution step
CREATE OR REPLACE FUNCTION log_execution_step(
  p_audit_id uuid,
  p_step text,
  p_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_step_sequence jsonb;
  v_last_step_time timestamptz;
  v_duration_ms integer;
BEGIN
  -- Get current step sequence and last step time
  SELECT
    step_sequence,
    (step_sequence->-1->>'timestamp')::timestamptz
  INTO v_step_sequence, v_last_step_time
  FROM entry_execution_audit
  WHERE id = p_audit_id;

  -- Calculate step duration
  v_duration_ms := EXTRACT(EPOCH FROM (now() - v_last_step_time)) * 1000;

  -- Append new step
  v_step_sequence := v_step_sequence || jsonb_build_object(
    'step', p_step,
    'timestamp', now(),
    'duration_ms', v_duration_ms,
    'details', COALESCE(p_details, '{}'::jsonb)
  );

  -- Update audit record
  UPDATE entry_execution_audit
  SET
    current_step = p_step,
    step_sequence = v_step_sequence
  WHERE id = p_audit_id;
END;
$$;

-- Helper function: Complete execution audit (success)
CREATE OR REPLACE FUNCTION complete_execution_audit(
  p_audit_id uuid,
  p_trade_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_duration_ms integer;
BEGIN
  -- Calculate total duration
  SELECT EXTRACT(EPOCH FROM (now() - started_at)) * 1000
  INTO v_duration_ms
  FROM entry_execution_audit
  WHERE id = p_audit_id;

  -- Mark as completed
  UPDATE entry_execution_audit
  SET
    current_step = 'COMPLETED',
    success = true,
    completed_at = now(),
    duration_ms = v_duration_ms,
    step_sequence = step_sequence || jsonb_build_object(
      'step', 'COMPLETED',
      'timestamp', now(),
      'trade_id', p_trade_id
    )
  WHERE id = p_audit_id;
END;
$$;

-- Helper function: Fail execution audit
CREATE OR REPLACE FUNCTION fail_execution_audit(
  p_audit_id uuid,
  p_failure_step text,
  p_failure_reason text,
  p_error_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_duration_ms integer;
BEGIN
  -- Calculate total duration
  SELECT EXTRACT(EPOCH FROM (now() - started_at)) * 1000
  INTO v_duration_ms
  FROM entry_execution_audit
  WHERE id = p_audit_id;

  -- Mark as failed
  UPDATE entry_execution_audit
  SET
    current_step = 'FAILED',
    success = false,
    failure_step = p_failure_step,
    failure_reason = p_failure_reason,
    error_details = COALESCE(p_error_details, '{}'::jsonb),
    completed_at = now(),
    duration_ms = v_duration_ms,
    step_sequence = step_sequence || jsonb_build_object(
      'step', 'FAILED',
      'timestamp', now(),
      'failure_step', p_failure_step,
      'failure_reason', p_failure_reason,
      'error_details', COALESCE(p_error_details, '{}'::jsonb)
    )
  WHERE id = p_audit_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_execution_audit TO service_role;
GRANT EXECUTE ON FUNCTION log_execution_step TO service_role;
GRANT EXECUTE ON FUNCTION complete_execution_audit TO service_role;
GRANT EXECUTE ON FUNCTION fail_execution_audit TO service_role;

-- Realtime (optional - for admin dashboard)
ALTER PUBLICATION supabase_realtime ADD TABLE entry_execution_audit;

COMMENT ON TABLE entry_execution_audit IS
'SSOT for entry intent execution tracking. Records every step to diagnose silent failures.';

COMMENT ON FUNCTION start_execution_audit IS
'Creates audit record for execution attempt. Returns audit_id for subsequent logging.';

COMMENT ON FUNCTION log_execution_step IS
'Logs a step in the execution process with timing and optional details.';

COMMENT ON FUNCTION complete_execution_audit IS
'Marks execution as successful and records final trade_id.';

COMMENT ON FUNCTION fail_execution_audit IS
'Marks execution as failed with detailed error information for Alpha analysis.';
