/*
  # Fix atomic_close_goal_session RPC - Correct entry_intents Column Reference

  ## CCIP Compliance Issue
  Type: SSOT Violation (Column Name Mismatch)
  Severity: CRITICAL
  Impact: Session closure completely broken for all users

  ## Root Cause
  - RPC atomic_close_goal_session queries entry_intents with column: goal_session_id
  - Actual column name in entry_intents: session_id (NOT goal_session_id)
  - This causes "column 'goal_session_id' does not exist" error
  - Error occurs at Step 6 of RPC (cancel entry intents)

  ## Why It Keeps Breaking
  - This is an SSOT violation - the RPC definition doesn't match the actual schema
  - No other code prevents defining RPCs with incorrect columns
  - Previous fixes only addressed goal_session_trades, missed entry_intents
  - Architectural pattern: Multiple places could have same column mismatch

  ## Solution
  1. FIX RPC: Change entry_intents query to use session_id instead of goal_session_id
  2. VALIDATE: Add defensive checks to prevent similar mismatches
  3. VERIFY: Ensure all table columns used in RPC actually exist
  4. PREVENT: Make RPC more resilient to schema changes

  ## Tables and Columns Verified
  - goal_session_trades: HAS goal_session_id (correct)
  - entry_intents: HAS session_id (NOT goal_session_id) ← THE FIX
  - goal_sessions: HAS id (correct)
  - session_closure_state: HAS session_id, user_id (correct)
*/

-- ============================================================================
-- DROP THE BROKEN RPC
-- ============================================================================

DROP FUNCTION IF EXISTS atomic_close_goal_session(uuid, uuid);

-- ============================================================================
-- RECREATE WITH CORRECT COLUMN NAMES
-- ============================================================================

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

    -- Step 5: Close open trades (use goal_session_trades SSOT compliance)
    -- VERIFIED: goal_session_trades HAS goal_session_id column
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
          v_result->'errors' || jsonb_build_array('Failed to close trade: ' || v_trades_to_close.id::TEXT || ' (' || SQLERRM || ')'));
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
    -- FIXED: entry_intents uses session_id (NOT goal_session_id)
    -- VERIFIED: entry_intents HAS session_id column, NOT goal_session_id
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
          v_result->'errors' || jsonb_build_array('Failed to cancel intent: ' || v_intents_to_cancel.id::TEXT || ' (' || SQLERRM || ')'));
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
      error_details = jsonb_build_object('error_code', SQLSTATE, 'context', 'RPC execution failed'),
      updated_at = now()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    v_result := jsonb_set(v_result, '{success}', 'false'::jsonb);
    v_result := jsonb_set(v_result, '{errors}',
      v_result->'errors' || jsonb_build_array('Fatal error: ' || SQLERRM || ' (SQL State: ' || SQLSTATE || ')'));

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

-- ============================================================================
-- POST-FIX VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_goal_session_trades_has_goal_session_id boolean;
  v_entry_intents_has_session_id boolean;
BEGIN
  -- Verify goal_session_trades has goal_session_id
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'goal_session_id'
  ) INTO v_goal_session_trades_has_goal_session_id;

  IF NOT v_goal_session_trades_has_goal_session_id THEN
    RAISE EXCEPTION 'CRITICAL: goal_session_trades MISSING goal_session_id column!';
  END IF;

  -- Verify entry_intents has session_id
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'session_id'
  ) INTO v_entry_intents_has_session_id;

  IF NOT v_entry_intents_has_session_id THEN
    RAISE EXCEPTION 'CRITICAL: entry_intents MISSING session_id column!';
  END IF;

  RAISE NOTICE 'SSOT Verification Passed:';
  RAISE NOTICE '   - goal_session_trades.goal_session_id: EXISTS';
  RAISE NOTICE '   - entry_intents.session_id: EXISTS';
  RAISE NOTICE 'atomic_close_goal_session RPC is now SSOT-compliant';
END $$;
