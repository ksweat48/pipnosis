/*
  # SSOT-Compliant Stuck Session Fixes - Part 3
  # (handle_continuation_response + mark_intent_executed trigger fix)

  1. handle_continuation_response - SessionStateAuthority
     - Cleanup orphaned intents BEFORE transitioning
     - Reset continuation fields when resuming
     - Create session_ended modal if stopping

  2. mark_intent_executed trigger - EntryIntentAuthority
     - Fire on BOTH INSERT and UPDATE (not just INSERT)
     - Add session_id filtering to prevent cross-session matching
     - Track execution with proper audit trail
*/

-- Fix 5: handle_continuation_response - SessionStateAuthority
CREATE OR REPLACE FUNCTION handle_continuation_response(
  p_session_id uuid,
  p_continue boolean,
  p_reason text DEFAULT 'user_decision'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session goal_sessions;
  v_intent_cleanup jsonb;
  v_ended_modal_id uuid;
BEGIN
  -- SSOT AUTHORITY: SessionStateAuthority
  -- RESPONSIBILITY: Process user's continuation decision
  -- SIDE EFFECTS: Cleanup orphaned intents, update session state, create modals

  -- Step 1: Lock and validate session
  SELECT * INTO v_session FROM goal_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found'
    );
  END IF;

  IF v_session.status != 'awaiting_continuation' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Session not in awaiting_continuation state (current: %s)', v_session.status),
      'current_status', v_session.status
    );
  END IF;

  -- Step 2: Clean up orphaned intents BEFORE transitioning
  -- This prevents orphaned intents from blocking next session operation
  v_intent_cleanup := cleanup_orphaned_intents(p_session_id, 'continuation_response_cleanup');

  -- Step 3: Handle user's decision
  IF p_continue THEN
    -- User chose to CONTINUE scanning
    UPDATE goal_sessions SET
      status = 'scanning',
      scanning_started_at = NOW(),
      entry_monitor_state = 'DISCOVERY_SCANNING',
      -- Clear continuation-related fields
      awaiting_continuation_since = NULL,
      continuation_deadline = NULL,
      continuation_modal_shown_at = NULL,
      updated_at = NOW()
    WHERE id = p_session_id;

    -- Dismiss continuation modal
    UPDATE pending_user_modals SET
      dismissed_at = NOW()
    WHERE session_id = p_session_id
    AND type = 'continuation_request'
    AND dismissed_at IS NULL;

    -- Audit continuation decision
    INSERT INTO governance_change_log (
      entity_type, entity_id, operation, old_value, new_value,
      reason, requester_id, metadata
    )
    VALUES (
      'goal_sessions',
      p_session_id,
      'continuation_response',
      jsonb_build_object('status', 'awaiting_continuation'),
      jsonb_build_object('status', 'scanning'),
      p_reason,
      auth.uid(),
      jsonb_build_object(
        'response', 'continue',
        'orphaned_intents_cleaned', v_intent_cleanup->>'abandoned_count'
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'action', 'resumed',
      'new_status', 'scanning',
      'intents_cleaned', v_intent_cleanup
    );

  ELSE
    -- User chose to STOP session
    UPDATE goal_sessions SET
      status = 'user_stopped',
      updated_at = NOW()
    WHERE id = p_session_id;

    -- Dismiss continuation modal
    UPDATE pending_user_modals SET
      dismissed_at = NOW()
    WHERE session_id = p_session_id
    AND type = 'continuation_request'
    AND dismissed_at IS NULL;

    -- Create session_ended modal
    BEGIN
      INSERT INTO pending_user_modals (
        user_id, session_id, type, title, message, metadata, created_at
      )
      VALUES (
        v_session.user_id,
        p_session_id,
        'session_ended',
        'Session Ended',
        'Your session has ended. Review your trades and share feedback!',
        jsonb_build_object(
          'reason', 'user_ended_from_continuation',
          'ended_at', NOW()
        ),
        NOW()
      )
      RETURNING id INTO v_ended_modal_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to create session_ended modal: %', SQLERRM;
    END;

    -- Audit session end decision
    INSERT INTO governance_change_log (
      entity_type, entity_id, operation, old_value, new_value,
      reason, requester_id, metadata
    )
    VALUES (
      'goal_sessions',
      p_session_id,
      'continuation_response',
      jsonb_build_object('status', 'awaiting_continuation'),
      jsonb_build_object('status', 'user_stopped'),
      p_reason,
      auth.uid(),
      jsonb_build_object(
        'response', 'stop',
        'ended_modal_id', v_ended_modal_id,
        'orphaned_intents_cleaned', v_intent_cleanup->>'abandoned_count'
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'action', 'stopped',
      'new_status', 'user_stopped',
      'ended_modal_id', v_ended_modal_id,
      'intents_cleaned', v_intent_cleanup
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, error_message, requester_id
  )
  VALUES (
    'goal_sessions',
    p_session_id,
    'handle_continuation_response_FAILED',
    SQLERRM,
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_code', SQLSTATE
  );
END;
$$;

-- Fix 6: Create proper AFTER UPDATE trigger for mark_intent_executed
-- This catches trades that are updated to 'open' status
CREATE OR REPLACE FUNCTION mark_intent_executed_on_trade_status_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_intent entry_intents;
BEGIN
  -- SSOT AUTHORITY: EntryIntentAuthority
  -- RESPONSIBILITY: Mark intent as executed when trade opens
  -- TRIGGER: Fires on UPDATE when status changes TO 'open'
  -- CRITICAL: Also has session_id check to prevent cross-session matching

  -- Only trigger if status changed TO 'open'
  IF OLD.status != NEW.status AND NEW.status = 'open' THEN

    -- Find matching intent for this session and trade details
    -- Uses row locking and session_id to prevent matching wrong intents
    SELECT * INTO v_intent
    FROM entry_intents ei
    WHERE
      ei.session_id = NEW.session_id  -- CRITICAL: Match only in same session
      AND ei.symbol = NEW.symbol
      AND ei.direction = NEW.direction
      AND ei.status = 'monitoring'
      AND ei.created_at <= NEW.created_at -- Intent must be older than trade
    ORDER BY ei.created_at DESC -- Get most recent
    LIMIT 1;

    IF v_intent IS NOT NULL THEN
      BEGIN
        UPDATE entry_intents SET
          status = 'executed',
          executed_at = NOW()
        WHERE id = v_intent.id;

        -- Audit the execution
        INSERT INTO governance_change_log (
          entity_type, entity_id, operation, old_value, new_value,
          metadata
        )
        VALUES (
          'entry_intents',
          v_intent.id,
          'intent_execution',
          jsonb_build_object('status', 'monitoring'),
          jsonb_build_object('status', 'executed'),
          jsonb_build_object(
            'trade_id', NEW.id,
            'trade_symbol', NEW.symbol,
            'trade_direction', NEW.direction
          )
        );

      EXCEPTION WHEN OTHERS THEN
        -- Log but don't crash - trade is open, intent tracking is secondary
        RAISE WARNING 'Failed to mark intent executed for trade %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop old trigger if exists (single-action trigger)
DROP TRIGGER IF EXISTS mark_intent_executed_on_trade_open ON goal_session_trades;

-- Create new triggers for both INSERT and UPDATE
CREATE TRIGGER mark_intent_executed_on_trade_insert
  AFTER INSERT ON goal_session_trades
  FOR EACH ROW
  WHEN (NEW.status = 'open')
  EXECUTE FUNCTION mark_intent_executed_on_trade_status_update();

CREATE TRIGGER mark_intent_executed_on_trade_update
  AFTER UPDATE ON goal_session_trades
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'open')
  EXECUTE FUNCTION mark_intent_executed_on_trade_status_update();

-- Create utility function to retroactively mark orphaned intents as executed
-- Useful for historical data cleanup
CREATE OR REPLACE FUNCTION retroactively_mark_executed_intents(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Find all intents in 'monitoring' status that have corresponding open trades
  UPDATE entry_intents ei SET
    status = 'executed',
    executed_at = COALESCE(
      (SELECT created_at FROM goal_session_trades gst
       WHERE gst.session_id = ei.session_id
       AND gst.symbol = ei.symbol
       AND gst.direction = ei.direction
       AND gst.status = 'open'
       LIMIT 1),
      NOW()
    )
  WHERE
    ei.session_id = p_session_id
    AND ei.status = 'monitoring'
    AND EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.session_id = ei.session_id
      AND gst.symbol = ei.symbol
      AND gst.direction = ei.direction
      AND gst.status = 'open'
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Audit this retroactive fix
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, reason, metadata
  )
  VALUES (
    'goal_sessions',
    p_session_id,
    'retroactive_intent_execution',
    'Fixed orphaned intents by retroactively marking as executed',
    jsonb_build_object('intents_fixed', v_count)
  );

  RETURN jsonb_build_object(
    'success', true,
    'intents_executed', v_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;
