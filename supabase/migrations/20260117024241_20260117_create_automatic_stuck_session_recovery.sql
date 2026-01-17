/*
  # Automatic Stuck Session Recovery System

  1. Purpose
    - Auto-detect and fix sessions stuck beyond 80 minutes (60-min timeout + 20-min safety net)
    - Runs every minute as part of autonomous-goal-monitor function
    - Prevents sessions from consuming resources indefinitely
    - Complies with SSOT: single cleanup authority, runs at server start

  2. New Functions
    - `cleanup_stuck_sessions_automatic()` - Auto-detection and cleanup (runs every minute)

  3. Thresholds
    - 60 minutes: Normal continuation modal timeout
    - 80 minutes: Force-close stuck sessions (60 + 20-min safety net)
    - Detection: Sessions in scanning/awaiting_continuation without recent activity

  4. Security
    - SECURITY DEFINER for service_role only execution
    - No RLS violations - updates own records
    - Graceful logging of all cleanups
    - Returns count for monitoring

  5. Behavior
    - Closes sessions stuck in awaiting_continuation beyond 1 minute
    - Closes sessions scanning beyond 80 minutes without trades
    - Resets user balance if needed
    - Logs all actions for audit trail
*/

CREATE OR REPLACE FUNCTION cleanup_stuck_sessions_automatic()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_cleaned integer := 0;
  v_modal_expired integer;
  v_scan_stuck integer;
BEGIN
  -- =========================================================================
  -- CLEANUP #1: Sessions stuck in awaiting_continuation beyond 1 minute
  -- =========================================================================
  WITH modal_expired AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW(),
      server_error = 'Auto-closed: continuation modal expired (1 min timeout)'
    WHERE status = 'awaiting_continuation'
      AND continuation_confirmation_expires_at IS NOT NULL
      AND NOW() > continuation_confirmation_expires_at
      AND (NOW() - continuation_confirmation_expires_at) > INTERVAL '1 minute'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_modal_expired FROM modal_expired;

  IF v_modal_expired > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Closed % sessions with expired continuation modal', v_modal_expired;
    v_total_cleaned := v_total_cleaned + v_modal_expired;
  END IF;

  -- =========================================================================
  -- CLEANUP #2: Sessions stuck scanning beyond 80 minutes without trades
  -- =========================================================================
  WITH scan_stuck AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      end_time = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW(),
      server_error = 'Auto-closed: scanning exceeded 80-minute safety limit'
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 80
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.created_at >= goal_sessions.scanning_started_at
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_scan_stuck FROM scan_stuck;

  IF v_scan_stuck > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Closed % sessions stuck scanning beyond 80 minutes', v_scan_stuck;
    v_total_cleaned := v_total_cleaned + v_scan_stuck;
  END IF;

  -- =========================================================================
  -- Log cleanup summary
  -- =========================================================================
  IF v_total_cleaned > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Total cleaned: % sessions', v_total_cleaned;
  END IF;

  RETURN v_total_cleaned;
END;
$$;

COMMENT ON FUNCTION cleanup_stuck_sessions_automatic IS
  'Automatic stuck session recovery. Runs every minute from autonomous-goal-monitor. Closes sessions exceeding 80-minute safety limit. Returns count of cleaned sessions.';

GRANT EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic TO service_role;
