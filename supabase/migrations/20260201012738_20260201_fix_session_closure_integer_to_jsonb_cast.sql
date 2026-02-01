/*
  # Fix Session Closure Type Casting Error

  ## Problem
  atomic_close_goal_session RPC was failing with:
  "FATAL: cannot cast type integer to jsonb [42846]"
  
  This occurred at line 272 where v_intent_count (INT) was being cast directly to jsonb.
  PostgreSQL does not support direct integer->jsonb casting.

  ## Solution
  Replace direct cast with proper JSONB conversion using to_jsonb() function.
  Also fix redundant jsonb_build_object cast on line 246.

  ## Files Modified
  - atomic_close_goal_session RPC function
  
  ## Changes
  - Line 246: Remove redundant ::jsonb cast from jsonb_build_object result
  - Line 272: Use to_jsonb(v_intent_count) instead of v_intent_count::jsonb
*/

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
  v_schema_validation jsonb;
BEGIN
  -- PREFLIGHT: Validate schema before attempting closure
  v_schema_validation := validate_critical_schema();

  IF (v_schema_validation->'valid')::boolean IS FALSE THEN
    RETURN jsonb_build_object(
      'success', false,
      'session_id', p_session_id,
      'user_id', p_user_id,
      'errors', jsonb_build_array('SCHEMA VALIDATION FAILED: ' || (v_schema_validation->'errors')::text),
      'schema_details', v_schema_validation,
      'recommendation', 'Database schema is corrupted. Contact system administrator.'
    );
  END IF;

  v_result := jsonb_build_object(
    'success', false,
    'session_id', p_session_id,
    'user_id', p_user_id,
    'steps_completed', jsonb_build_object(),
    'errors', jsonb_build_array(),
    'schema_validated', true
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
    SET
      status = 'initiated',
      attempt_number = session_closure_state.attempt_number + 1,
      updated_at = now()
    RETURNING * INTO v_closure;

    -- Step 3: Mark session as stopping
    UPDATE goal_sessions
    SET closing_state = 'stopping', updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{steps_completed,session_marked_stopping}', 'true'::jsonb);

    -- Step 4: Stop polling
    UPDATE session_closure_state
    SET
      status = 'polling_stopped',
      polling_stopped_at = now(),
      updated_at = now()
    WHERE session_closure_state.id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,polling_stopped}', 'true'::jsonb);

    -- Step 5: Close open trades
    FOR v_trades_to_close IN
      SELECT id FROM goal_session_trades
      WHERE goal_session_id = p_session_id AND status = 'open'
    LOOP
      BEGIN
        UPDATE trade_records
        SET status = 'closed', close_reason = 'session_stopped', updated_at = now()
        WHERE trade_records.id = v_trades_to_close.id;
        v_trade_count := v_trade_count + 1;
      EXCEPTION WHEN OTHERS THEN
        v_trade_failed := v_trade_failed + 1;
        v_result := jsonb_set(v_result, '{errors}',
          v_result->'errors' || jsonb_build_array('Failed to close trade: ' || v_trades_to_close.id::TEXT || ' - ' || SQLERRM));
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
      jsonb_build_object('count', v_trade_count, 'failed', v_trade_failed));

    -- Step 6: Cancel entry intents (uses session_id, NOT goal_session_id)
    FOR v_intents_to_cancel IN
      SELECT id FROM entry_intents
      WHERE session_id = p_session_id AND status NOT IN ('canceled', 'expired_no_entry')
    LOOP
      BEGIN
        UPDATE entry_intents
        SET status = 'canceled', conditions_changed_at = now(), updated_at = now()
        WHERE entry_intents.id = v_intents_to_cancel.id;
        v_intent_count := v_intent_count + 1;
      EXCEPTION WHEN OTHERS THEN
        v_result := jsonb_set(v_result, '{errors}',
          v_result->'errors' || jsonb_build_array('Failed to cancel intent: ' || v_intents_to_cancel.id::TEXT || ' - ' || SQLERRM));
      END;
    END LOOP;

    UPDATE session_closure_state
    SET
      status = 'intents_canceled',
      intents_canceled_count = v_intent_count,
      intents_canceled_at = now(),
      updated_at = now()
    WHERE session_closure_state.id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,intents_canceled}', to_jsonb(v_intent_count));

    -- Step 7: Final cleanup
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      closing_state = 'idle',
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id;

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
      error_details = jsonb_build_object(
        'error_code', SQLSTATE,
        'context', 'RPC execution failed',
        'step', 'unknown'
      ),
      updated_at = now()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{success}', 'false'::jsonb);
    v_result := jsonb_set(v_result, '{errors}',
      v_result->'errors' || jsonb_build_array('FATAL: ' || SQLERRM || ' [' || SQLSTATE || ']'));

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

GRANT EXECUTE ON FUNCTION atomic_close_goal_session(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION atomic_close_goal_session(uuid, uuid) TO service_role;
