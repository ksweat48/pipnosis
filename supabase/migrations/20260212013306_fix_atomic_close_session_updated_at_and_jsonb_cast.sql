/*
  # Fix atomic_close_goal_session RPC - Two Critical Bugs

  1. Bug Fixes
    - `entry_intents` UPDATE references `updated_at` column which does not exist on the table
    - `v_intent_count::jsonb` fails because PostgreSQL cannot directly cast integer to jsonb
  
  2. Changes
    - Remove `updated_at = now()` from entry_intents UPDATE (column does not exist)
    - Replace `v_intent_count::jsonb` with `to_jsonb(v_intent_count)` for proper conversion
  
  3. Security
    - No RLS changes
    - Function remains SECURITY DEFINER with proper auth checks
  
  4. SSOT Compliance
    - entry_intents tracks cancellation via `canceled_at` and `conditions_changed_at` (both exist)
    - No new columns added; fix aligns with actual schema
*/

CREATE OR REPLACE FUNCTION atomic_close_goal_session(p_session_id uuid, p_user_id uuid)
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
  v_current_price numeric;
  v_close_result jsonb;
BEGIN
  v_result := jsonb_build_object(
    'success', false,
    'session_id', p_session_id,
    'user_id', p_user_id,
    'steps_completed', jsonb_build_object(),
    'errors', jsonb_build_array()
  );

  BEGIN
    SELECT * INTO v_session
    FROM goal_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

    IF v_session IS NULL THEN
      v_result := jsonb_set(v_result, '{errors}',
        v_result->'errors' || jsonb_build_array('Session not found or unauthorized'));
      RAISE EXCEPTION 'Session not found or unauthorized';
    END IF;

    INSERT INTO session_closure_state (session_id, user_id, status)
    VALUES (p_session_id, p_user_id, 'initiated')
    ON CONFLICT (session_id) DO UPDATE
    SET
      status = 'initiated',
      attempt_number = session_closure_state.attempt_number + 1,
      updated_at = now()
    RETURNING * INTO v_closure;

    UPDATE goal_sessions
    SET closing_state = 'stopping', updated_at = now()
    WHERE id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{steps_completed,session_marked_stopping}', 'true'::jsonb);

    UPDATE session_closure_state
    SET
      status = 'polling_stopped',
      polling_stopped_at = now(),
      updated_at = now()
    WHERE session_closure_state.id = v_closure.id;

    v_result := jsonb_set(v_result, '{steps_completed,polling_stopped}', 'true'::jsonb);

    FOR v_trades_to_close IN
      SELECT id, symbol FROM goal_session_trades
      WHERE goal_session_id = p_session_id AND status = 'open'
    LOOP
      BEGIN
        SELECT bid INTO v_current_price
        FROM realtime_prices
        WHERE symbol = v_trades_to_close.symbol
        ORDER BY timestamp DESC
        LIMIT 1;

        IF v_current_price IS NULL THEN
          SELECT current_price INTO v_current_price
          FROM goal_session_trades
          WHERE id = v_trades_to_close.id;
        END IF;

        SELECT close_goal_session_trade(
          v_trades_to_close.id,
          v_current_price,
          'session_ended',
          p_session_id,
          false,
          now()
        ) INTO v_close_result;

        v_trade_count := v_trade_count + 1;

      EXCEPTION WHEN OTHERS THEN
        v_trade_failed := v_trade_failed + 1;
        v_result := jsonb_set(v_result, '{errors}',
          v_result->'errors' || jsonb_build_array(
            'Failed to close trade: ' || v_trades_to_close.id::TEXT || ' - ' || SQLERRM
          ));
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

    FOR v_intents_to_cancel IN
      SELECT id FROM entry_intents
      WHERE session_id = p_session_id AND status NOT IN ('canceled', 'expired_no_entry')
    LOOP
      BEGIN
        UPDATE entry_intents
        SET
          status = 'canceled',
          canceled_at = now(),
          conditions_changed_at = now()
        WHERE entry_intents.id = v_intents_to_cancel.id;
        v_intent_count := v_intent_count + 1;
      EXCEPTION WHEN OTHERS THEN
        v_result := jsonb_set(v_result, '{errors}',
          v_result->'errors' || jsonb_build_array(
            'Failed to cancel intent: ' || v_intents_to_cancel.id::TEXT || ' - ' || SQLERRM
          ));
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
        'context', 'RPC execution failed'
      ),
      updated_at = now()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{success}', 'false'::jsonb);
    v_result := jsonb_set(v_result, '{errors}',
      v_result->'errors' || jsonb_build_array(
        'Fatal error: ' || SQLERRM || ' (SQL State: ' || SQLSTATE || ')'
      ));

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
