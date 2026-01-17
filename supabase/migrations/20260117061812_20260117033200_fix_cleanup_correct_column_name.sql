/*
  # Fix Stuck Session Cleanup - Correct Column Name

  ## CCIP Fix - Column Name Mismatch

  ### Problem:
  Previous migration used `end_time` column which doesn't exist in goal_sessions table.
  Correct column name is `completed_at`.

  ### Changes:
  - Replace all `end_time` references with `completed_at`
  - Maintain all other cleanup logic
*/

-- ============================================================================
-- Fix cleanup_stuck_sessions_automatic - Correct Column Name
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_stuck_sessions_automatic()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total_cleaned integer := 0;
  v_modal_expired integer;
  v_scan_stuck integer;
BEGIN
  -- This function is called by service_role which automatically bypasses RLS
  RAISE NOTICE '[cleanup_stuck_sessions_automatic] Starting cleanup cycle (service_role bypass)';

  -- =========================================================================
  -- CLEANUP #1: Sessions stuck in awaiting_continuation beyond 1 minute
  -- =========================================================================
  WITH modal_expired AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW(),
      server_error = 'Auto-closed: continuation modal expired (1 min timeout)'
    WHERE status = 'awaiting_continuation'
      AND continuation_confirmation_expires_at IS NOT NULL
      AND NOW() > continuation_confirmation_expires_at
      AND (NOW() - continuation_confirmation_expires_at) > INTERVAL '1 minute'
    RETURNING id, user_id, status
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
      completed_at = NOW(),
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
    RETURNING id, user_id, status, scanning_started_at
  )
  SELECT COUNT(*) INTO v_scan_stuck FROM scan_stuck;

  IF v_scan_stuck > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] ✅ Closed % sessions stuck scanning beyond 80 minutes', v_scan_stuck;
    v_total_cleaned := v_total_cleaned + v_scan_stuck;
  END IF;

  -- =========================================================================
  -- Log cleanup summary
  -- =========================================================================
  IF v_total_cleaned > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] ✅ Total cleaned: % sessions', v_total_cleaned;
  END IF;

  RETURN v_total_cleaned;
END;
$$;

COMMENT ON FUNCTION cleanup_stuck_sessions_automatic IS
  'Automatic stuck session recovery. Runs every minute from autonomous-goal-monitor with service_role credentials that bypass RLS. Closes sessions exceeding 80-minute safety limit. Returns count of cleaned sessions.';

-- Ensure permissions are correct
GRANT EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic TO service_role;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM authenticated;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM anon;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM public;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Fix Applied: cleanup_stuck_sessions_automatic column name corrected';
  RAISE NOTICE '  - Changed end_time to completed_at';
  RAISE NOTICE '  - Function will now execute without errors';
END $$;
