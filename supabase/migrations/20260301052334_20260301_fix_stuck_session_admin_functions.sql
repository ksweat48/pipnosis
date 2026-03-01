/*
  # Fix Stuck Session Admin Functions — Dead Column References & Time Reference Drift

  ## Summary
  Two stuck-session admin functions had schema mismatches that could cause failures.

  ## Problems Fixed

  ### 1. admin_emergency_stop_long_sessions
  - Referenced `end_time` column (does not exist; column is `completed_at`)
  - Referenced `awaiting_continuation_confirmation` column (deleted in a prior migration)
  - Referenced `continuation_confirmation_expires_at` column (deleted in a prior migration)
  - Fixed: use `completed_at`, remove deleted column assignments

  ### 2. force_close_stale_scanning_sessions
  - Used `cycle_started_at` as the age reference; `cycle_started_at` is reset on every
    scanning cycle reset, so a long-running session that had a cycle reset would not be
    detected as stale
  - Fixed: use `scanning_started_at` (matches the automatic pg_cron cleanup which is
    already proven working), with `created_at` as fallback

  ## No data loss — both are UPDATE operations on sessions that are stuck/stale.
*/

-- =========================================================
-- FIX 1: admin_emergency_stop_long_sessions
-- Remove dead column references (end_time, awaiting_continuation_confirmation,
-- continuation_confirmation_expires_at) and use completed_at instead.
-- =========================================================
CREATE OR REPLACE FUNCTION admin_emergency_stop_long_sessions(p_hours_threshold numeric DEFAULT 2)
RETURNS TABLE(session_id uuid, user_email text, scanning_duration_hours numeric, stopped_at timestamptz)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
BEGIN
  SELECT COALESCE(up.is_admin, false) INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT calling_user_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH long_sessions AS (
    SELECT
      gs.id,
      gs.user_id,
      gs.scanning_started_at,
      EXTRACT(EPOCH FROM (now() - gs.scanning_started_at)) / 3600 AS hours_elapsed
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
    status      = 'user_stopped',
    completed_at = now(),
    updated_at  = now()
  FROM long_sessions ls
  WHERE gs.id = ls.id
  RETURNING
    gs.id AS session_id,
    (SELECT au.email FROM auth.users au WHERE au.id = gs.user_id) AS user_email,
    ls.hours_elapsed AS scanning_duration_hours,
    now() AS stopped_at;
END;
$$;

-- =========================================================
-- FIX 2: force_close_stale_scanning_sessions
-- Use scanning_started_at (never reset) instead of cycle_started_at
-- (reset on every cycle) so the admin button matches the same criteria
-- as the automatic pg_cron cleanup.
-- =========================================================
CREATE OR REPLACE FUNCTION force_close_stale_scanning_sessions()
RETURNS TABLE(session_id uuid, user_id uuid, minutes_scanning numeric)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = calling_user_id
      AND user_profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH stale_sessions AS (
    UPDATE goal_sessions
    SET
      status       = 'user_stopped',
      completed_at = NOW(),
      updated_at   = NOW()
    WHERE status IN ('scanning', 'trade_pending')
      AND COALESCE(scanning_started_at, created_at) IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - COALESCE(scanning_started_at, created_at))) / 60 > 30
    RETURNING
      goal_sessions.id,
      goal_sessions.user_id,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(goal_sessions.scanning_started_at, goal_sessions.created_at))) / 60 AS minutes_scanning
  )
  SELECT
    stale_sessions.id,
    stale_sessions.user_id,
    stale_sessions.minutes_scanning
  FROM stale_sessions;
END;
$$;
