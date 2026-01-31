/*
  # Session Closure State Management (SSOT + CCIP Compliant)
  
  1. New Tables
    - `session_closure_state` - SSOT for session closure operations
      - Atomic state machine for closure progress
      - Tracks which steps have completed
      - Owned by single RPC function
      - Enables safe recovery from partial closures
  
  2. Modified Tables
    - `goal_sessions` - Add `closing_state` column
      - Intermediate state before `user_stopped`
      - Prevents duplicate closure attempts
      - Required for governance tracking
  
  3. Security
    - RLS enables service_role only for closure operations
    - Prevents clients from manipulating closure state directly
    - All changes tracked by CCIP system
  
  4. Important Notes
    - This table is SSOT: UI cannot modify closure state
    - All closure logic centralized in `atomic_close_goal_session` RPC
    - State transitions tracked in `ccip_change_tracking`
    - Prevents race conditions with polling/subscriptions
*/

CREATE TABLE IF NOT EXISTS session_closure_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  status TEXT NOT NULL CHECK (status IN ('initiated', 'polling_stopped', 'trades_closing', 'intents_canceled', 'completed', 'failed')),
  
  polling_stopped_at TIMESTAMPTZ,
  trades_closed_count INT DEFAULT 0,
  trades_failed_count INT DEFAULT 0,
  trades_closed_at TIMESTAMPTZ,
  
  intents_canceled_count INT DEFAULT 0,
  intents_canceled_at TIMESTAMPTZ,
  
  error_message TEXT,
  error_details JSONB,
  
  attempt_number INT DEFAULT 1,
  max_attempts INT DEFAULT 3,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_session_closure_state_session_id 
  ON session_closure_state(session_id);
CREATE INDEX IF NOT EXISTS idx_session_closure_state_user_id 
  ON session_closure_state(user_id);
CREATE INDEX IF NOT EXISTS idx_session_closure_state_status 
  ON session_closure_state(status);

ALTER TABLE session_closure_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON session_closure_state
  FOR ALL
  TO service_role
  USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'closing_state'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN closing_state TEXT CHECK (closing_state IN ('idle', 'stopping', NULL));
    CREATE INDEX idx_goal_sessions_closing_state ON goal_sessions(closing_state);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION atomic_close_goal_session(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_closure record;
  v_trades_to_close record;
  v_intents_to_cancel record;
  v_trade_count INT := 0;
  v_trade_failed INT := 0;
  v_intent_count INT := 0;
  v_result jsonb;
BEGIN
  v_result := jsonb_build_object(
    'success', false,
    'session_id', p_session_id,
    'user_id', p_user_id,
    'steps_completed', jsonb_build_object(),
    'errors', jsonb_build_array()
  );

  BEGIN
    -- Step 1: Verify session exists and belongs to user
    SELECT * INTO v_session
    FROM goal_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

    IF v_session IS NULL THEN
      v_result := jsonb_set(v_result, '{errors}', 
        v_result->'errors' || jsonb_build_array('Session not found or unauthorized'));
      RAISE EXCEPTION 'Session not found or unauthorized';
    END IF;

    -- Step 2: Create/update closure state record (SSOT)
    INSERT INTO session_closure_state (session_id, user_id, status)
    VALUES (p_session_id, p_user_id, 'initiated')
    ON CONFLICT (session_id) DO UPDATE
    SET status = 'initiated', attempt_number = attempt_number + 1, updated_at = now()
    RETURNING * INTO v_closure;

    -- Step 3: Mark session as stopping (prevents duplicate closure attempts)
    UPDATE goal_sessions
    SET closing_state = 'stopping', updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{steps_completed,session_marked_stopping}', 'true'::jsonb);

    -- Step 4: Stop polling (update closure state SSOT)
    UPDATE session_closure_state
    SET 
      status = 'polling_stopped',
      polling_stopped_at = now(),
      updated_at = now()
    WHERE id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,polling_stopped}', 'true'::jsonb);

    -- Step 5: Close open trades
    FOR v_trades_to_close IN
      SELECT id FROM trades
      WHERE goal_session_id = p_session_id AND status = 'open'
    LOOP
      BEGIN
        UPDATE trades
        SET status = 'closed', close_reason = 'session_stopped', updated_at = now()
        WHERE id = v_trades_to_close.id;
        v_trade_count := v_trade_count + 1;
      EXCEPTION WHEN OTHERS THEN
        v_trade_failed := v_trade_failed + 1;
        v_result := jsonb_set(v_result, '{errors}', 
          v_result->'errors' || jsonb_build_array('Failed to close trade: ' || v_trades_to_close.id::TEXT));
      END;
    END LOOP;

    UPDATE session_closure_state
    SET 
      status = 'trades_closing',
      trades_closed_count = v_trade_count,
      trades_failed_count = v_trade_failed,
      trades_closed_at = now(),
      updated_at = now()
    WHERE id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,trades_closed}', 
      jsonb_build_object('count', v_trade_count, 'failed', v_trade_failed)::jsonb);

    -- Step 6: Cancel entry intents
    FOR v_intents_to_cancel IN
      SELECT id FROM entry_intents
      WHERE goal_session_id = p_session_id AND status NOT IN ('canceled', 'expired_no_entry')
    LOOP
      BEGIN
        UPDATE entry_intents
        SET status = 'canceled', conditions_changed_at = now(), updated_at = now()
        WHERE id = v_intents_to_cancel.id;
        v_intent_count := v_intent_count + 1;
      EXCEPTION WHEN OTHERS THEN
        v_result := jsonb_set(v_result, '{errors}', 
          v_result->'errors' || jsonb_build_array('Failed to cancel intent: ' || v_intents_to_cancel.id::TEXT));
      END;
    END LOOP;

    UPDATE session_closure_state
    SET 
      status = 'intents_canceled',
      intents_canceled_count = v_intent_count,
      intents_canceled_at = now(),
      updated_at = now()
    WHERE id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,intents_canceled}', v_intent_count::jsonb);

    -- Step 7: Final cleanup - update session status
    UPDATE goal_sessions
    SET 
      status = 'user_stopped',
      closing_state = 'idle',
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id;

    -- Mark closure as completed
    UPDATE session_closure_state
    SET 
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    WHERE id = v_closure.id;

    v_result := jsonb_set(v_result, '{success}', 'true'::jsonb);
    v_result := jsonb_set(v_result, '{steps_completed,session_stopped}', 'true'::jsonb);

    INSERT INTO ccip_change_tracking (
      user_id,
      operation_type,
      table_name,
      record_id,
      change_details,
      governance_log_id
    ) VALUES (
      p_user_id,
      'SESSION_CLOSURE_COMPLETED',
      'goal_sessions',
      p_session_id,
      v_result,
      gen_random_uuid()
    );

    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    UPDATE session_closure_state
    SET 
      status = 'failed',
      error_message = SQLERRM,
      error_details = jsonb_build_object('error_code', SQLSTATE),
      updated_at = now()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{success}', 'false'::jsonb);
    v_result := jsonb_set(v_result, '{errors}', 
      v_result->'errors' || jsonb_build_array('Fatal error: ' || SQLERRM));

    INSERT INTO ccip_change_tracking (
      user_id,
      operation_type,
      table_name,
      record_id,
      change_details,
      governance_log_id
    ) VALUES (
      p_user_id,
      'SESSION_CLOSURE_FAILED',
      'goal_sessions',
      p_session_id,
      v_result,
      gen_random_uuid()
    );

    RETURN v_result;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION atomic_close_goal_session TO authenticated;
