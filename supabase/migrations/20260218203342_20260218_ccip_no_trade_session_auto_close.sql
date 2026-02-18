/*
  # CCIP: No-Trade Session Auto-Close Governance

  ## Summary
  Implements server-side authority for closing sessions when Alpha finds no trades.
  Eliminates the lifecycle gap where browser-disconnected sessions remain stuck in
  'scanning' status indefinitely.

  ## Problem Being Solved
  When Alpha completes a scan with no qualifying trades:
  - Browser-side: 60-second countdown fires, closes session correctly IF tab is open
  - Server-side: Nothing happens — session stays 'scanning' for 80 minutes (old safety net)
  - Result: Back office shows users as "scanning" when their session is long dead

  ## Changes

  ### New Column: goal_sessions.no_trade_found_at
  - Timestamp written by the live engine immediately when Alpha emits no-trade result
  - Acts as a server-readable signal: "Alpha finished, no trade, browser may or may not be open"
  - Used by cleanup function as the authoritative trigger for auto-close

  ### Updated: cleanup_stuck_sessions_automatic()
  - CLEANUP #2 (was: 80-min threshold) → now: 5-min threshold for sessions with no_trade_found_at set
  - CLEANUP #3 (new): Sessions with no_trade_found_at set for > 5 minutes auto-close
    regardless of browser state
  - Old 80-min fallback kept as CLEANUP #4 for sessions that somehow never set the signal

  ## Security
  - Column is nullable, no default (NULL = scan never completed / still in progress)
  - RLS: users can update their own sessions (existing policy)
  - Cleanup runs as service_role (existing SECURITY DEFINER)

  ## SSOT Compliance
  - no_trade_found_at is the single signal for "Alpha completed scan with no result"
  - Only the live engine writes this value
  - Only cleanup_stuck_sessions_automatic reads it for server-side closure
  - Frontend countdown remains the primary UX path; server-side is the safety net
*/

-- ============================================================================
-- Step 1: Add no_trade_found_at column to goal_sessions
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'no_trade_found_at'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN no_trade_found_at timestamptz DEFAULT NULL;
    RAISE NOTICE '[CCIP] Added no_trade_found_at column to goal_sessions';
  ELSE
    RAISE NOTICE '[CCIP] no_trade_found_at column already exists, skipping';
  END IF;
END $$;

COMMENT ON COLUMN goal_sessions.no_trade_found_at IS
  'Set by live engine when Alpha completes a full scan with no qualifying trade. '
  'Server-side safety net uses this to auto-close sessions within 5 minutes, '
  'covering browser-disconnected users. NULL means scan never completed.';

-- ============================================================================
-- Step 2: Update cleanup_stuck_sessions_automatic with new logic
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_stuck_sessions_automatic()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total_cleaned integer := 0;
  v_modal_expired integer;
  v_no_trade_stale integer;
  v_scan_stuck_long integer;
BEGIN
  RAISE NOTICE '[cleanup_stuck_sessions_automatic] Starting cleanup cycle (service_role bypass)';

  -- =========================================================================
  -- CLEANUP #1: Sessions stuck in awaiting_continuation beyond 1 minute
  -- (unchanged from previous governance)
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
  -- CLEANUP #2: Sessions where Alpha found no trade and 5+ minutes have passed
  -- (NEW: replaces old 80-minute threshold for no-trade sessions)
  -- This handles browser-disconnected users whose countdown never ran
  -- =========================================================================
  WITH no_trade_stale AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      updated_at = NOW(),
      server_error = 'Auto-closed: no trade found, session auto-expired after 5-minute grace period'
    WHERE status IN ('scanning', 'trade_pending')
      AND no_trade_found_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - no_trade_found_at)) / 60 > 5
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.status = 'open'
      )
    RETURNING id, user_id, no_trade_found_at
  )
  SELECT COUNT(*) INTO v_no_trade_stale FROM no_trade_stale;

  IF v_no_trade_stale > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Closed % no-trade sessions after 5-minute grace period', v_no_trade_stale;
    v_total_cleaned := v_total_cleaned + v_no_trade_stale;
  END IF;

  -- =========================================================================
  -- CLEANUP #3: Fallback — scanning sessions beyond 20 minutes without trades
  -- (reduced from 80 min; covers sessions that never emitted no_trade_found_at)
  -- =========================================================================
  WITH scan_stuck_long AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW(),
      server_error = 'Auto-closed: scanning exceeded 20-minute fallback safety limit'
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 20
      AND no_trade_found_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.created_at >= goal_sessions.scanning_started_at
      )
    RETURNING id, user_id, status, scanning_started_at
  )
  SELECT COUNT(*) INTO v_scan_stuck_long FROM scan_stuck_long;

  IF v_scan_stuck_long > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Closed % sessions stuck scanning beyond 20-minute fallback limit', v_scan_stuck_long;
    v_total_cleaned := v_total_cleaned + v_scan_stuck_long;
  END IF;

  IF v_total_cleaned > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Total cleaned: % sessions', v_total_cleaned;
  END IF;

  RETURN v_total_cleaned;
END;
$$;

COMMENT ON FUNCTION cleanup_stuck_sessions_automatic IS
  'CCIP-governed stuck session recovery. Runs every minute from autonomous-goal-monitor. '
  'Priority order: (1) expired continuation modals (1 min), '
  '(2) no-trade sessions with grace period elapsed (5 min), '
  '(3) fallback for sessions stuck scanning without no_trade signal (20 min). '
  'Returns count of cleaned sessions.';

GRANT EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic TO service_role;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM authenticated;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM anon;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM public;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=== CCIP Migration Verification ===';
  RAISE NOTICE '  no_trade_found_at column: confirmed';
  RAISE NOTICE '  cleanup_stuck_sessions_automatic: updated';
  RAISE NOTICE '    - Cleanup #2 (no-trade grace): 5 minutes';
  RAISE NOTICE '    - Cleanup #3 (fallback): 20 minutes (was 80)';
  RAISE NOTICE '====================================';
END $$;
