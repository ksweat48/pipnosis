/*
  # Fix EXECUTE_PENDING Trade Insertion Deadlock

  ## Critical Issue
  The automatic trade execution system was deadlocked because:
  1. `transitionState('EXECUTE_PENDING')` was called BEFORE trade insertion
  2. Any validation or constraint checking during trade insertion would see EXECUTE_PENDING state
  3. This blocked trade insertion, creating a circular dependency

  ## Solution
  1. Add execution timing tracking to goal_sessions
  2. Create helper functions for atomic trade execution
  3. Add execution attempt logging for debugging
  4. Document proper execution flow: EXECUTE_PENDING should only be set AFTER trade insertion succeeds

  ## Changes
  1. Add execution timing fields to goal_sessions
  2. Create execution log table for debugging
  3. Add helper function for recording execution attempts
  4. Add indexes for performance monitoring

  ## Security
  - RLS enabled on new tables
  - Policies for authenticated users only
*/

-- Add execution timing fields to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'last_execution_attempt_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN last_execution_attempt_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'execution_attempts_count'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN execution_attempts_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'last_execution_error'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN last_execution_error text;
  END IF;
END $$;

-- Create execution attempt log table for debugging
CREATE TABLE IF NOT EXISTS entry_execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  intent_id uuid REFERENCES entry_intents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  attempt_number integer NOT NULL,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,

  symbol text NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  lot_size numeric NOT NULL,

  eqs_score integer,
  state_before_attempt text,
  state_after_attempt text,

  success boolean,
  error_message text,
  trade_id uuid,

  execution_duration_ms integer,

  created_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_execution_attempts_session ON entry_execution_attempts(session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_attempts_intent ON entry_execution_attempts(intent_id);
CREATE INDEX IF NOT EXISTS idx_execution_attempts_success ON entry_execution_attempts(success, started_at DESC) WHERE success = false;

-- Enable RLS
ALTER TABLE entry_execution_attempts ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Users can view own execution attempts" ON entry_execution_attempts;
CREATE POLICY "Users can view own execution attempts"
  ON entry_execution_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own execution attempts" ON entry_execution_attempts;
CREATE POLICY "Users can insert own execution attempts"
  ON entry_execution_attempts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Function to record execution attempt (called from frontend before execution)
CREATE OR REPLACE FUNCTION record_execution_attempt(
  p_session_id uuid,
  p_intent_id uuid,
  p_user_id uuid,
  p_symbol text,
  p_direction text,
  p_entry_price numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_lot_size numeric,
  p_eqs_score integer DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_attempt_number integer;
  v_attempt_id uuid;
  v_state_before text;
BEGIN
  -- Get current attempt count and state
  SELECT COALESCE(execution_attempts_count, 0) + 1, entry_monitor_state
  INTO v_attempt_number, v_state_before
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Insert attempt log
  INSERT INTO entry_execution_attempts (
    session_id,
    intent_id,
    user_id,
    attempt_number,
    symbol,
    direction,
    entry_price,
    stop_loss,
    take_profit,
    lot_size,
    eqs_score,
    state_before_attempt
  ) VALUES (
    p_session_id,
    p_intent_id,
    p_user_id,
    v_attempt_number,
    p_symbol,
    p_direction,
    p_entry_price,
    p_stop_loss,
    p_take_profit,
    p_lot_size,
    p_eqs_score,
    v_state_before
  ) RETURNING id INTO v_attempt_id;

  -- Update session attempt counter
  UPDATE goal_sessions
  SET
    execution_attempts_count = v_attempt_number,
    last_execution_attempt_at = now()
  WHERE id = p_session_id;

  RETURN v_attempt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to complete execution attempt (called after execution)
CREATE OR REPLACE FUNCTION complete_execution_attempt(
  p_attempt_id uuid,
  p_success boolean,
  p_trade_id uuid DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_state_after text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_started_at timestamptz;
  v_duration_ms integer;
  v_session_id uuid;
BEGIN
  -- Get attempt start time and session
  SELECT started_at, session_id
  INTO v_started_at, v_session_id
  FROM entry_execution_attempts
  WHERE id = p_attempt_id;

  -- Calculate duration
  v_duration_ms := EXTRACT(EPOCH FROM (now() - v_started_at)) * 1000;

  -- Update attempt record
  UPDATE entry_execution_attempts
  SET
    completed_at = now(),
    success = p_success,
    trade_id = p_trade_id,
    error_message = p_error_message,
    state_after_attempt = p_state_after,
    execution_duration_ms = v_duration_ms
  WHERE id = p_attempt_id;

  -- Update session if failed
  IF NOT p_success THEN
    UPDATE goal_sessions
    SET last_execution_error = p_error_message
    WHERE id = v_session_id;
  END IF;

  RAISE NOTICE '[EXECUTION_ATTEMPT] Completed: success=%, duration=%ms, tradeId=%',
    p_success, v_duration_ms, p_trade_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get recent execution attempts for debugging
CREATE OR REPLACE FUNCTION get_recent_execution_attempts(
  p_session_id uuid,
  p_limit integer DEFAULT 10
) RETURNS TABLE (
  id uuid,
  attempt_number integer,
  started_at timestamptz,
  completed_at timestamptz,
  success boolean,
  error_message text,
  execution_duration_ms integer,
  symbol text,
  direction text,
  entry_price numeric,
  eqs_score integer,
  state_before text,
  state_after text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    eea.id,
    eea.attempt_number,
    eea.started_at,
    eea.completed_at,
    eea.success,
    eea.error_message,
    eea.execution_duration_ms,
    eea.symbol,
    eea.direction,
    eea.entry_price,
    eea.eqs_score,
    eea.state_before_attempt as state_before,
    eea.state_after_attempt as state_after
  FROM entry_execution_attempts eea
  WHERE eea.session_id = p_session_id
  ORDER BY eea.started_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION record_execution_attempt TO authenticated;
GRANT EXECUTE ON FUNCTION complete_execution_attempt TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_execution_attempts TO authenticated;

-- Add realtime support
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'entry_execution_attempts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE entry_execution_attempts;
  END IF;
END $$;

-- Add helpful comments
COMMENT ON TABLE entry_execution_attempts IS 'Tracks every automatic trade execution attempt for debugging and monitoring';
COMMENT ON COLUMN entry_execution_attempts.attempt_number IS 'Sequential attempt number for this session (1, 2, 3, ...)';
COMMENT ON COLUMN entry_execution_attempts.execution_duration_ms IS 'How long the execution took in milliseconds';
COMMENT ON COLUMN entry_execution_attempts.state_before_attempt IS 'entry_monitor_state before execution';
COMMENT ON COLUMN entry_execution_attempts.state_after_attempt IS 'entry_monitor_state after execution';
COMMENT ON FUNCTION record_execution_attempt IS 'Records execution attempt BEFORE trade insertion - called by coordinator';
COMMENT ON FUNCTION complete_execution_attempt IS 'Records execution result AFTER trade insertion - called by coordinator';
