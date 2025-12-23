/*
  # Fix end_time Column Reference - Use completed_at Instead

  1. Problem
    - force_close_stale_session() tries to update 'end_time' column
    - check_continuation_modal_timeout() tries to update 'end_time' column
    - The actual column in goal_sessions is called 'completed_at' (added in migration 20251218174713)
    - This causes 400 errors: "column 'end_time' of relation 'goal_sessions' does not exist"
    - Sessions cannot be closed, causing infinite retry loops

  2. Changes
    - Update force_close_stale_session() to use 'completed_at' instead of 'end_time'
    - Update check_continuation_modal_timeout() to use 'completed_at' instead of 'end_time'
    - Both functions will now successfully close sessions

  3. Security
    - Functions use SECURITY DEFINER (already set)
    - No changes to permissions or RLS policies
*/

-- ============================================================================
-- Fix check_continuation_modal_timeout - use completed_at instead of end_time
-- ============================================================================

CREATE OR REPLACE FUNCTION check_continuation_modal_timeout(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_timed_out boolean := false;
  v_duration_minutes numeric;
  v_trades_count integer;
  v_close_reason text;
BEGIN
  SELECT
    awaiting_continuation_confirmation,
    continuation_confirmation_expires_at,
    status,
    scanning_started_at,
    created_at,
    user_id,
    current_progress,
    target_value
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  -- Check #1: Standard timeout (awaiting_continuation with expired timestamp)
  IF v_session.awaiting_continuation_confirmation
     AND v_session.continuation_confirmation_expires_at IS NOT NULL
     AND now() > v_session.continuation_confirmation_expires_at
     AND v_session.status IN ('awaiting_continuation', 'scanning', 'trade_pending')
  THEN
    v_close_reason := 'timeout';
    v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

    SELECT COUNT(*) INTO v_trades_count
    FROM goal_session_trades
    WHERE goal_session_id = p_session_id
      AND status IN ('open', 'closed');

    INSERT INTO goal_notifications (
      goal_session_id,
      user_id,
      type,
      priority,
      title,
      message,
      metadata,
      channels
    ) VALUES (
      p_session_id,
      v_session.user_id,
      'session_ended',
      'high',
      'Session Timed Out',
      format('Your session ended after no response. %s trade%s completed. Final: $%s',
        v_trades_count,
        CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
        ROUND(COALESCE(v_session.current_progress, 0)::numeric, 2)),
      jsonb_build_object(
        'close_reason', v_close_reason,
        'duration_minutes', v_duration_minutes,
        'trades_in_session', v_trades_count,
        'current_progress', COALESCE(v_session.current_progress, 0),
        'target_value', COALESCE(v_session.target_value, 0)
      ),
      ARRAY['in_app']
    );

    RAISE NOTICE '[check_continuation_modal_timeout] Session % timed out - auto-closing', p_session_id;

    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_session_id;

    v_timed_out := true;
  END IF;

  -- Check #2: Safety net - session scanning >20 min without trade and no modal
  IF NOT v_timed_out
     AND v_session.status IN ('scanning', 'trade_pending')
     AND v_session.scanning_started_at IS NOT NULL
     AND NOT v_session.awaiting_continuation_confirmation
     AND EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60 > 20
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = p_session_id
        AND gst.created_at >= v_session.scanning_started_at
    ) THEN
      v_close_reason := 'safety_net';
      v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

      SELECT COUNT(*) INTO v_trades_count
      FROM goal_session_trades
      WHERE goal_session_id = p_session_id
        AND status IN ('open', 'closed');

      INSERT INTO goal_notifications (
        goal_session_id,
        user_id,
        type,
        priority,
        title,
        message,
        metadata,
        channels
      ) VALUES (
        p_session_id,
        v_session.user_id,
        'session_ended',
        'high',
        'Safety Stop Triggered',
        format('Your session was auto-closed after 20 minutes. %s trade%s completed. Final: $%s',
          v_trades_count,
          CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
          ROUND(COALESCE(v_session.current_progress, 0)::numeric, 2)),
        jsonb_build_object(
          'close_reason', v_close_reason,
          'duration_minutes', v_duration_minutes,
          'trades_in_session', v_trades_count,
          'current_progress', COALESCE(v_session.current_progress, 0),
          'target_value', COALESCE(v_session.target_value, 0)
        ),
        ARRAY['in_app']
      );

      RAISE NOTICE '[check_continuation_modal_timeout] Session % safety net triggered - scanning >20min', p_session_id;

      UPDATE goal_sessions
      SET
        status = 'user_stopped',
        awaiting_continuation_confirmation = false,
        continuation_confirmation_expires_at = NULL,
        completed_at = now(),
        updated_at = now()
      WHERE id = p_session_id;

      v_timed_out := true;
    END IF;
  END IF;

  RETURN v_timed_out;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'Checks if continuation modal has timed out (1 minute) and auto-closes session. Uses completed_at column.';

-- ============================================================================
-- Fix force_close_stale_session - use completed_at instead of end_time
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_stale_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_duration_minutes numeric;
  v_trades_count integer;
BEGIN
  SELECT
    id,
    user_id,
    status,
    scanning_started_at,
    created_at,
    current_progress,
    target_value
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session IS NULL THEN
    RETURN false;
  END IF;

  IF v_session.status NOT IN ('scanning', 'trade_pending', 'awaiting_continuation', 'initializing') THEN
    RETURN false;
  END IF;

  v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

  SELECT COUNT(*) INTO v_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status IN ('open', 'closed');

  INSERT INTO goal_notifications (
    goal_session_id,
    user_id,
    type,
    priority,
    title,
    message,
    metadata,
    channels
  ) VALUES (
    p_session_id,
    v_session.user_id,
    'session_ended',
    'medium',
    'Session Force Closed',
    format('Your session was force closed. %s trade%s completed. Final: $%s',
      v_trades_count,
      CASE WHEN v_trades_count != 1 THEN 's' ELSE '' END,
      ROUND(COALESCE(v_session.current_progress, 0)::numeric, 2)),
    jsonb_build_object(
      'close_reason', 'force_closed',
      'duration_minutes', v_duration_minutes,
      'trades_in_session', v_trades_count,
      'current_progress', COALESCE(v_session.current_progress, 0),
      'target_value', COALESCE(v_session.target_value, 0)
    ),
    ARRAY['in_app']
  );

  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  RAISE NOTICE '[force_close_stale_session] Session % force closed by user', p_session_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION force_close_stale_session IS
  'Allows users to force-close their own stale sessions. Uses completed_at column.';

GRANT EXECUTE ON FUNCTION force_close_stale_session TO authenticated;
GRANT EXECUTE ON FUNCTION check_continuation_modal_timeout TO authenticated;