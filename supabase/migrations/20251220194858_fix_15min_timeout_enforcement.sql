/*
  # Fix 15-Minute Timeout Enforcement

  ## Problem
  - Sessions stuck in 'awaiting_continuation' status are excluded from server processing
  - Timeout check never runs, allowing sessions to waste resources indefinitely
  - Admin dashboard shows misleading duration (from session start instead of current period)

  ## Solution
  1. Emergency cleanup: Close all currently stuck sessions
  2. Fix get_sessions_for_server_processing() to include awaiting_continuation status
  3. Fix admin_get_all_users() to show current scanning period duration

  ## Impact
  - Stops resource waste immediately
  - Ensures 15-minute timeout always enforced
  - Provides accurate admin visibility
*/

-- ============================================================================
-- STEP 1: Emergency cleanup - close all stuck sessions
-- ============================================================================

DO $$
DECLARE
  v_stuck_count integer;
BEGIN
  -- Close sessions stuck in awaiting_continuation with expired timeout
  WITH closed_sessions AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE status = 'awaiting_continuation'
      AND continuation_confirmation_expires_at IS NOT NULL
      AND now() > continuation_confirmation_expires_at
    RETURNING id
  )
  SELECT COUNT(*) INTO v_stuck_count FROM closed_sessions;

  IF v_stuck_count > 0 THEN
    RAISE NOTICE '[Emergency Cleanup] Closed % stuck sessions with expired timeouts', v_stuck_count;
  END IF;

  -- Safety net: Close any session that has been scanning for over 2 hours
  WITH long_sessions AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = now()
    WHERE status IN ('scanning', 'trade_pending')
      AND start_time IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - start_time)) / 3600 >= 2
    RETURNING id
  )
  SELECT COUNT(*) INTO v_stuck_count FROM long_sessions;

  IF v_stuck_count > 0 THEN
    RAISE NOTICE '[Emergency Cleanup] Closed % sessions running over 2 hours', v_stuck_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Fix get_sessions_for_server_processing() to include awaiting_continuation
-- ============================================================================

CREATE OR REPLACE FUNCTION get_sessions_for_server_processing()
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  watchlist text[],
  target_value numeric,
  current_progress numeric,
  server_last_check timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gs.id as session_id,
    gs.user_id,
    gs.watchlist,
    gs.target_value,
    gs.current_progress,
    gs.server_last_check
  FROM goal_sessions gs
  WHERE
    -- CRITICAL: Must include 'awaiting_continuation' so timeout check can run
    gs.status IN ('scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing', 'awaiting_continuation')
    AND gs.server_enabled = true
    AND gs.autonomous_enabled = true
    AND (
      gs.server_last_check IS NULL
      OR gs.server_last_check < now() - INTERVAL '30 seconds'
    )
  ORDER BY
    COALESCE(gs.server_last_check, gs.created_at) ASC
  LIMIT 50;
END;
$$;

COMMENT ON FUNCTION get_sessions_for_server_processing IS
  'Returns active sessions for server processing. MUST include awaiting_continuation status to enforce 1-minute timeout on continuation modal.';

-- ============================================================================
-- STEP 3: Fix admin_get_all_users() to show current scanning period duration
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_all_users(
  search_email text DEFAULT NULL,
  limit_count int DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
  account_balance decimal,
  credit_balance decimal,
  total_trades bigint,
  active_trades bigint,
  scanning_sessions bigint,
  scanning_duration_minutes numeric,
  last_activity timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
BEGIN
  -- Check if calling user is admin
  SELECT COALESCE(up.is_admin, false) INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT calling_user_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.id as user_id,
    au.email::text,
    up.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0) as credit_balance,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.id AND gst.status = 'closed'),
      0
    )::bigint as total_trades,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.id AND gst.status = 'open'),
      0
    )::bigint as active_trades,
    COALESCE(
      (SELECT COUNT(*) FROM goal_sessions gs WHERE gs.user_id = up.id AND gs.status IN ('scanning', 'awaiting_continuation')),
      0
    )::bigint as scanning_sessions,
    -- Calculate duration from current scanning period start (scanning_started_at)
    -- This resets each time user clicks "Continue", showing accurate current period
    (
      SELECT EXTRACT(EPOCH FROM (NOW() - COALESCE(gs.scanning_started_at, gs.start_time)))/60
      FROM goal_sessions gs
      WHERE gs.user_id = up.id AND gs.status IN ('scanning', 'awaiting_continuation')
      ORDER BY gs.start_time DESC
      LIMIT 1
    ) as scanning_duration_minutes,
    GREATEST(
      up.created_at,
      COALESCE((SELECT MAX(closed_at) FROM goal_session_trades gst WHERE gst.user_id = up.id), up.created_at),
      COALESCE((SELECT MAX(updated_at) FROM goal_sessions gs WHERE gs.user_id = up.id), up.created_at)
    ) as last_activity
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY up.created_at DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION admin_get_all_users IS
  'Get all users with stats. scanning_duration_minutes shows CURRENT 15-minute period (from scanning_started_at), not total session time.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_sessions_for_server_processing TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_all_users TO authenticated;
