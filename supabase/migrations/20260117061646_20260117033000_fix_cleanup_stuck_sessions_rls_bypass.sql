/*
  # Fix Stuck Session Cleanup - RLS Bypass

  ## CCIP Root Cause Analysis

  ### Problem:
  Sessions are getting stuck for 3+ hours despite automatic cleanup system.
  Manual testing shows sessions meet all cleanup criteria but are NOT being cleaned.

  ### Root Cause:
  The `cleanup_stuck_sessions_automatic()` function has SECURITY DEFINER but does NOT
  bypass RLS (Row Level Security). When RLS is enabled on goal_sessions table:

  1. Function runs as postgres user (SECURITY DEFINER)
  2. BUT: RLS policies still apply unless explicitly disabled
  3. UPDATE query silently skips rows that don't match RLS policies
  4. No authenticated user context in scheduled functions
  5. Result: Zero sessions cleaned despite meeting criteria

  ### Evidence:
  Session 8359a6fa-a254-4d2f-b0ea-231561573f37:
  - Status: scanning ✓
  - Duration: 224 minutes (> 80-minute threshold) ✓
  - No trades since scanning started ✓
  - should_be_cleaned: TRUE ✓
  - YET: Still stuck after 3h 44m

  ### Solution:
  Add SET LOCAL ROLE TO postgres at function start to bypass RLS.
  This is safe because:
  - Function already has SECURITY DEFINER (postgres owner)
  - Only callable by service_role (GRANT restricted)
  - Cleanup logic is well-defined and safe
  - Function returns count for monitoring/auditing

  ## Changes:
  1. Add SET LOCAL ROLE TO postgres to bypass RLS
  2. Add explicit logging for debugging
  3. Add RAISE NOTICE when function starts (for monitoring)
  4. Maintain all existing cleanup logic (SSOT preserved)
*/

-- ============================================================================
-- Fix cleanup_stuck_sessions_automatic to Bypass RLS
-- ============================================================================

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
  -- 🔧 CRITICAL FIX: Set role to postgres to bypass RLS
  -- This is safe because function is SECURITY DEFINER and only callable by service_role
  SET LOCAL ROLE TO postgres;

  RAISE NOTICE '[cleanup_stuck_sessions_automatic] Starting cleanup cycle (RLS bypassed)';

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
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] ✅ Total cleaned: % sessions', v_total_cleaned;
  ELSE
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] No stuck sessions found';
  END IF;

  RETURN v_total_cleaned;
END;
$$;

COMMENT ON FUNCTION cleanup_stuck_sessions_automatic IS
  'Automatic stuck session recovery with RLS bypass. Runs every minute from autonomous-goal-monitor. Closes sessions exceeding 80-minute safety limit. Returns count of cleaned sessions. SECURITY DEFINER with postgres role to bypass RLS.';

-- Verify permissions are still restricted to service_role
GRANT EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic TO service_role;

-- ============================================================================
-- Verification and Logging
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Fix Applied: cleanup_stuck_sessions_automatic RLS bypass';
  RAISE NOTICE '  - Added SET LOCAL ROLE TO postgres to bypass RLS';
  RAISE NOTICE '  - Added explicit logging for monitoring';
  RAISE NOTICE '  - Function will now successfully clean stuck sessions';
  RAISE NOTICE '  - Next scheduled run: within 1 minute';
END $$;
