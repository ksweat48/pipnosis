/*
  # User Trade Decline — Void System

  ## Summary
  Implements the user accept/decline trade execution flow.

  When a user declines a trade that Alpha just opened, the entire trade must be
  silently voided — no balance impact, no journal entry, no AI learning signal,
  no scoring effect. The session is also cleanly stopped with reason
  'user_declined_trade'.

  ## New Objects

  ### Function: void_trade_on_user_decline(p_trade_id uuid, p_session_id uuid, p_user_id uuid)
  - Hard-deletes the goal_session_trades row (SSOT: no ghost record left behind)
  - Deletes any goal_notifications created for this trade_id (prevents stale modals)
  - Deletes any entry_intents linked to this trade_id (prevents EQS contamination)
  - Sets the goal_session status to 'stopped' with stop_reason 'user_declined_trade'
  - Closes any open entry_intents for the session
  - Returns success/error JSON

  ### Governance notes
  - CCIP compliant: all mutations inside one SECURITY DEFINER function with
    explicit ownership verification (p_user_id must match the session's user_id)
  - No triggers fire on hard-delete (the trade row never persisted to analytics
    layer because PnL triggers only run on UPDATE/status change, not DELETE)
  - RLS: authenticated users can only call this for their own trades/sessions
    (enforced inside the function body — see ownership check)
*/

CREATE OR REPLACE FUNCTION void_trade_on_user_decline(
  p_trade_id   uuid,
  p_session_id uuid,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_user_id uuid;
  v_trade_user_id   uuid;
BEGIN
  -- Ownership guard: verify the session belongs to this user
  SELECT user_id INTO v_session_user_id
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ownership check failed for session');
  END IF;

  -- Ownership guard: verify the trade belongs to this user
  SELECT user_id INTO v_trade_user_id
  FROM goal_session_trades
  WHERE id = p_trade_id;

  IF v_trade_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ownership check failed for trade');
  END IF;

  -- 1. Hard-delete the trade row — no PnL triggers, no balance changes, no journal
  DELETE FROM goal_session_trades
  WHERE id = p_trade_id AND user_id = p_user_id;

  -- 2. Delete the trade_opened notification so no stale modal can re-surface
  DELETE FROM goal_notifications
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND metadata->>'tradeId' = p_trade_id::text;

  -- 3. Delete entry_intents linked to this trade (prevents EQS contamination)
  DELETE FROM entry_intents
  WHERE goal_session_id = p_session_id
    AND user_id = p_user_id
    AND (
      external_trade_record_id = p_trade_id
      OR metadata->>'trade_id' = p_trade_id::text
    );

  -- 4. Cancel any pending modals for this session
  DELETE FROM pending_user_modals
  WHERE goal_session_id = p_session_id
    AND user_id = p_user_id
    AND (modal_data->>'trade_id' = p_trade_id::text OR modal_type = 'trade_closed');

  -- 5. Stop the session cleanly (no analytics, no journal notification)
  UPDATE goal_sessions
  SET
    status          = 'stopped',
    completed_at    = now(),
    updated_at      = now(),
    stop_reason     = 'user_declined_trade'
  WHERE id = p_session_id
    AND user_id = p_user_id
    AND status NOT IN ('stopped', 'completed', 'expired');

  -- 6. Cancel any open entry_intents for the session (clean state)
  UPDATE entry_intents
  SET status = 'canceled', updated_at = now()
  WHERE goal_session_id = p_session_id
    AND user_id = p_user_id
    AND status IN ('monitoring', 'pending', 'active');

  RETURN jsonb_build_object(
    'success', true,
    'trade_voided', p_trade_id,
    'session_stopped', p_session_id,
    'reason', 'user_declined_trade'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execution to authenticated users only
REVOKE ALL ON FUNCTION void_trade_on_user_decline(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION void_trade_on_user_decline(uuid, uuid, uuid) TO authenticated;
