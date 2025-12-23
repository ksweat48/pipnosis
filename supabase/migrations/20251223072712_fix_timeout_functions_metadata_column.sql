/*
  # Fix Timeout Functions - Use metadata Instead of data

  1. Problem
    - check_continuation_modal_timeout() tries to insert into goal_notifications with column 'data'
    - force_close_stale_session() tries to insert into goal_notifications with column 'data'
    - Actual column name is 'metadata' (was renamed in earlier migration)
    - This causes the auto-close to fail with database errors
    - Sessions get stuck, user never sees session_ended modal
    - Infinite retry loop occurs

  2. Changes
    - Update check_continuation_modal_timeout() to use 'metadata' column
    - Update force_close_stale_session() to use 'metadata' column
    - Both functions will now successfully insert notifications
    - Auto-close will work correctly

  3. Security
    - Functions use SECURITY DEFINER (already set)
    - No changes to permissions or RLS policies
*/

-- ============================================================================
-- Fix check_continuation_modal_timeout - use metadata instead of data
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

    -- Count trades in session
    SELECT COUNT(*) INTO v_trades_count
    FROM goal_session_trades
    WHERE goal_session_id = p_session_id
      AND status IN ('open', 'closed');

    -- Insert session_ended notification for push (FIXED: use metadata instead of data)
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
      '⏰ Session Timed Out',
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
      end_time = now(),
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
    -- Check if any trades found
    IF NOT EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = p_session_id
        AND gst.created_at >= v_session.scanning_started_at
    ) THEN
      v_close_reason := 'safety_net';
      v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

      -- Count trades in session
      SELECT COUNT(*) INTO v_trades_count
      FROM goal_session_trades
      WHERE goal_session_id = p_session_id
        AND status IN ('open', 'closed');

      -- Insert session_ended notification for push (FIXED: use metadata instead of data)
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
        '🛡️ Safety Stop Triggered',
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
        end_time = now(),
        updated_at = now()
      WHERE id = p_session_id;

      v_timed_out := true;
    END IF;
  END IF;

  RETURN v_timed_out;
END;
$$;

COMMENT ON FUNCTION check_continuation_modal_timeout IS
  'Checks if continuation modal has timed out (1 minute) and auto-closes session with push notification. Also includes 20-minute safety net for stuck sessions.';

-- ============================================================================
-- Fix force_close_stale_session - use metadata instead of data
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
  -- Get session and verify ownership
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

  -- Only close if in an active status
  IF v_session.status NOT IN ('scanning', 'trade_pending', 'awaiting_continuation', 'initializing') THEN
    RETURN false;
  END IF;

  -- Calculate duration
  v_duration_minutes := EXTRACT(EPOCH FROM (now() - COALESCE(v_session.scanning_started_at, v_session.created_at))) / 60;

  -- Count trades in session
  SELECT COUNT(*) INTO v_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status IN ('open', 'closed');

  -- Insert session_ended notification for push (FIXED: use metadata instead of data)
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
    '✋ Session Force Closed',
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

  -- Force close the session
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    end_time = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  RAISE NOTICE '[force_close_stale_session] Session % force closed by user', p_session_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION force_close_stale_session IS
  'Allows users to force-close their own stale sessions with push notification as a client-side fallback';
