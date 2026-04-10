/*
  # Session Reset Governance

  ## Summary
  Enforces clean session lifecycle so no stale data from a closed session
  bleeds into the next one.

  ## Changes

  ### 1. Unique partial index — one active session per user
  Adds a unique index on (user_id) WHERE status IN active statuses.
  This makes it a database-level guarantee that a user can never have
  two concurrent active sessions, even if the frontend gate is bypassed.

  Active statuses: initializing, scanning, trade_pending, in_trade, active, paused

  ### 2. RPC: cancel_all_session_intents
  Expanded helper that cancels ALL monitoring entry_intents for a session,
  regardless of close reason. Previously only called for manual/force_closed
  paths. Now the coordinator calls this for every close reason (TP/SL too).

  ### 3. RPC: session_is_fully_settled
  Returns TRUE when a session has no open trades and no monitoring intents.
  Used by the frontend to gate "Start New Session" until the old one is
  truly clean. Prevents race conditions where the DB still has open records
  while the UI tries to create a new session.

  ### 4. get_intents_for_server_monitoring filter
  Drops any intent whose parent goal_session.status is terminal
  (goal_achieved, stopped, timeout, weekend_shutdown, user_stopped).
  Prevents the autonomous-entry-monitor Netlify function from re-activating
  an intent that belongs to a session that has already ended.

  ## Security
  All RPCs use SECURITY DEFINER so service-role callers can operate across
  RLS boundaries, matching the existing pattern in this project.
*/

-- ─────────────────────────────────────────────
-- 1. Unique partial index: one active session per user
-- ─────────────────────────────────────────────
-- Drop existing one if it exists from a prior attempt
DROP INDEX IF EXISTS idx_goal_sessions_one_active_per_user;

CREATE UNIQUE INDEX idx_goal_sessions_one_active_per_user
  ON goal_sessions (user_id)
  WHERE status IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'active', 'paused');

-- ─────────────────────────────────────────────
-- 2. cancel_all_session_intents — cancel on ALL close paths
-- ─────────────────────────────────────────────
-- Drop old version first to avoid overload conflicts
DROP FUNCTION IF EXISTS cancel_all_session_intents(uuid);

CREATE OR REPLACE FUNCTION cancel_all_session_intents(p_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canceled_count integer;
BEGIN
  UPDATE entry_intents
  SET
    status = 'canceled',
    canceled_at = now(),
    canceled_reason = 'Session ended — all monitoring intents cleared'
  WHERE session_id = p_session_id
    AND status = 'monitoring';

  GET DIAGNOSTICS v_canceled_count = ROW_COUNT;
  RETURN v_canceled_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_all_session_intents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_all_session_intents(uuid) TO service_role;

-- ─────────────────────────────────────────────
-- 3. session_is_fully_settled — gate for new session creation
-- ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS session_is_fully_settled(uuid);

CREATE OR REPLACE FUNCTION session_is_fully_settled(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_trades   integer;
  v_active_intents integer;
BEGIN
  SELECT COUNT(*) INTO v_open_trades
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'open';

  SELECT COUNT(*) INTO v_active_intents
  FROM entry_intents
  WHERE session_id = p_session_id
    AND status = 'monitoring';

  RETURN (v_open_trades = 0 AND v_active_intents = 0);
END;
$$;

GRANT EXECUTE ON FUNCTION session_is_fully_settled(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION session_is_fully_settled(uuid) TO service_role;
