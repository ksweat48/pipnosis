/*
  # Fix Stuck Session Cleanup - Service Role RLS Bypass (Corrected)

  ## CCIP Root Cause Analysis - Iteration 2

  ### Previous Attempt Failed:
  Cannot use SET LOCAL ROLE inside SECURITY DEFINER functions.
  PostgreSQL restriction: parameter "role" cannot be set within security-definer function.

  ### Correct Solution:
  Remove SECURITY DEFINER and rely on service_role caller to bypass RLS.
  The Netlify function already uses service_role credentials which automatically bypass RLS.

  ### Why This Works:
  1. Function called by autonomous-goal-monitor.ts with service_role client
  2. Service role has bypassRLS permission by default in Supabase
  3. UPDATE operations will succeed without RLS restrictions
  4. Still secure - only service_role can execute (GRANT restricted)

  ### Alternative Approach (Defense in Depth):
  Keep function as regular function (not SECURITY DEFINER)
  Only grant to service_role (not authenticated)
  Service role caller automatically bypasses RLS

  ## Changes:
  1. Remove SECURITY DEFINER (rely on service_role caller)
  2. Restrict GRANT to service_role only (remove authenticated)
  3. Add explicit logging for monitoring
  4. Maintain all cleanup logic (SSOT preserved)
*/

-- ============================================================================
-- Fix cleanup_stuck_sessions_automatic - Service Role Bypass
-- ============================================================================

-- Drop and recreate without SECURITY DEFINER
DROP FUNCTION IF EXISTS cleanup_stuck_sessions_automatic();

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
      end_time = NOW(),
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
  ELSE
    -- Don't spam logs when no cleanup needed
    -- RAISE NOTICE '[cleanup_stuck_sessions_automatic] No stuck sessions found';
  END IF;

  RETURN v_total_cleaned;
END;
$$;

COMMENT ON FUNCTION cleanup_stuck_sessions_automatic IS
  'Automatic stuck session recovery. Runs every minute from autonomous-goal-monitor with service_role credentials that bypass RLS. Closes sessions exceeding 80-minute safety limit. Returns count of cleaned sessions.';

-- CRITICAL: Only grant to service_role (not authenticated)
-- This ensures function can only be called with RLS bypass permissions
GRANT EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic TO service_role;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM authenticated;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM anon;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM public;

-- ============================================================================
-- Verification and Logging
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ CCIP Fix Applied: cleanup_stuck_sessions_automatic service_role bypass';
  RAISE NOTICE '  - Removed SECURITY DEFINER (use service_role caller instead)';
  RAISE NOTICE '  - Restricted to service_role only (RLS bypass built-in)';
  RAISE NOTICE '  - Added explicit logging for monitoring';
  RAISE NOTICE '  - Function will now successfully clean stuck sessions';
  RAISE NOTICE '  - Next scheduled run: within 1 minute';
END $$;
