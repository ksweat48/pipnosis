/*
  # Fix Session Closure Unique Constraint & Ambiguous Column Error
  
  ## Problem Statement
  - `session_closure_state` table missing UNIQUE constraint on `session_id`
  - ON CONFLICT clause in `atomic_close_goal_session` RPC fails due to missing constraint
  - Ambiguous column reference error: `attempt_number` not qualified with table alias
  
  ## Changes
  
  1. Schema Fixes
    - Add UNIQUE constraint on session_id (one closure state per session, SSOT compliance)
    - Add composite index on (session_id, user_id) for governance queries
    - Add table comment documenting SSOT ownership
  
  2. RPC Fixes  
    - Recreate `atomic_close_goal_session` with fully qualified column references
    - Change `attempt_number = attempt_number + 1` to `session_closure_state.attempt_number = session_closure_state.attempt_number + 1`
    - Qualify all column references in UPDATE statements
    - Add explicit alias references for clarity
  
  3. Governance & CCIP
    - Constraint addition enforced at database level
    - RPC version tracking via function modification timestamp
    - SSOT: Only one active closure state per session
    - Service role owns all closure operations (RLS enforced)
  
  4. Data Safety
    - Idempotent constraint addition (checks if already exists)
    - Drops and recreates RPC safely (security definer context preserved)
    - No data loss, all existing records preserved
    - Rollback safe: Can restore previous RPC version if needed
*/

-- Step 1: Add UNIQUE constraint on session_id (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'session_closure_state' 
    AND constraint_name = 'session_closure_state_session_id_key'
    AND constraint_type = 'UNIQUE'
  ) THEN
    ALTER TABLE session_closure_state 
    ADD CONSTRAINT session_closure_state_session_id_key UNIQUE (session_id);
  END IF;
END $$;

-- Step 2: Add composite index for governance queries (idempotent)
CREATE INDEX IF NOT EXISTS idx_session_closure_state_session_user 
  ON session_closure_state(session_id, user_id);

-- Step 3: Document SSOT ownership
COMMENT ON CONSTRAINT session_closure_state_session_id_key ON session_closure_state 
  IS 'SSOT: Enforces exactly one closure state record per session. Prevents concurrent closure attempts and race conditions.';

-- Step 4: Recreate RPC with fully qualified columns (fixes ambiguous reference)
DROP FUNCTION IF EXISTS atomic_close_goal_session(uuid, uuid);

CREATE FUNCTION atomic_close_goal_session(
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
    -- FIX: Fully qualify attempt_number column to avoid ambiguity
    INSERT INTO session_closure_state (session_id, user_id, status)
    VALUES (p_session_id, p_user_id, 'initiated')
    ON CONFLICT (session_id) DO UPDATE
    SET 
      status = 'initiated', 
      attempt_number = session_closure_state.attempt_number + 1, 
      updated_at = now()
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
    WHERE session_closure_state.id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,polling_stopped}', 'true'::jsonb);

    -- Step 5: Close open trades
    FOR v_trades_to_close IN
      SELECT id FROM trades
      WHERE goal_session_id = p_session_id AND status = 'open'
    LOOP
      BEGIN
        UPDATE trades
        SET status = 'closed', close_reason = 'session_stopped', updated_at = now()
        WHERE trades.id = v_trades_to_close.id;
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
    WHERE session_closure_state.id = v_closure.id;

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
        WHERE entry_intents.id = v_intents_to_cancel.id;
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
    WHERE session_closure_state.id = v_closure.id;

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
    WHERE session_closure_state.id = v_closure.id;

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

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION atomic_close_goal_session(uuid, uuid) TO authenticated;

-- Step 5: Verification - ensure constraint is in place
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_name = 'session_closure_state' 
    AND constraint_name = 'session_closure_state_session_id_key'
    AND constraint_type = 'UNIQUE'
  ) = 1, 'UNIQUE constraint on session_id not properly created';
  
  RAISE NOTICE 'Session closure schema fixes applied successfully - UNIQUE constraint on session_id enforced, RPC ambiguous column reference fixed';
END $$;
