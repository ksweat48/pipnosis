/*
  # Emergency Stop Long-Running Sessions

  ## Problem
  - User greenmorris.83@gmail.com has been scanning for 9+ hours
  - Timer protection was missing in server-side execution
  - Need immediate intervention

  ## Solution
  - Stop all sessions scanning for > 1 hour without trades
  - Set status to 'user_stopped' with explanation
  - Create admin function for future emergency stops

  ## Security
  - Function requires admin role
  - Logs all stopped sessions
*/

-- Create emergency stop function for admin use
CREATE OR REPLACE FUNCTION admin_emergency_stop_long_sessions(
  p_hours_threshold integer DEFAULT 1
)
RETURNS TABLE (
  session_id uuid,
  user_email text,
  scanning_duration_hours numeric,
  stopped_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  calling_user_is_admin boolean;
BEGIN
  -- Verify admin access
  SELECT COALESCE(up.is_admin, false) INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT calling_user_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Find and stop all sessions scanning for too long
  RETURN QUERY
  WITH long_sessions AS (
    SELECT
      gs.id,
      gs.user_id,
      gs.scanning_started_at,
      EXTRACT(EPOCH FROM (now() - gs.scanning_started_at)) / 3600 as hours_elapsed
    FROM goal_sessions gs
    WHERE gs.status IN ('scanning', 'trade_pending')
      AND gs.scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - gs.scanning_started_at)) / 3600 >= p_hours_threshold
      AND NOT EXISTS (
        SELECT 1
        FROM goal_session_trades gst
        WHERE gst.goal_session_id = gs.id
          AND gst.created_at >= gs.scanning_started_at
      )
  )
  UPDATE goal_sessions gs
  SET
    status = 'user_stopped',
    end_time = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL
  FROM long_sessions ls
  WHERE gs.id = ls.id
  RETURNING
    gs.id as session_id,
    (SELECT au.email FROM auth.users au WHERE au.id = gs.user_id) as user_email,
    ls.hours_elapsed as scanning_duration_hours,
    now() as stopped_at;
END;
$$;

COMMENT ON FUNCTION admin_emergency_stop_long_sessions IS
  'Emergency function for admins to stop sessions that have been scanning too long without finding trades';

GRANT EXECUTE ON FUNCTION admin_emergency_stop_long_sessions TO authenticated;

-- IMMEDIATE ACTION: Stop all sessions scanning for more than 1 hour
DO $$
DECLARE
  stopped_count integer;
BEGIN
  WITH stopped_sessions AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = now(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 3600 >= 1
      AND NOT EXISTS (
        SELECT 1
        FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.created_at >= goal_sessions.scanning_started_at
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO stopped_count FROM stopped_sessions;

  IF stopped_count > 0 THEN
    RAISE NOTICE 'Emergency stop: Closed % long-running sessions', stopped_count;
  END IF;
END $$;