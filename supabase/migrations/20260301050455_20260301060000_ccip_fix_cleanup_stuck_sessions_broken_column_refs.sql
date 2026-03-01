/*
  # CCIP Fix: Repair cleanup_stuck_sessions_automatic — Broken Column References

  ## Problem (Root Cause)
  The pg_cron job `cleanup-stuck-goal-sessions` has been FAILING on EVERY run with:
    ERROR: column "continuation_confirmation_expires_at" does not exist

  The `cleanup_stuck_sessions_automatic()` function was written against columns that no
  longer exist in `goal_sessions` due to a prior governance migration that removed the
  continuation confirmation system. Because Cleanup #1 references these deleted columns,
  PL/pgSQL aborts the ENTIRE function — meaning Cleanups #2 through #5 NEVER execute.
  Sessions that should have been auto-closed after 20 minutes have been running for days.

  ## Deleted Columns Referenced (now removed from function):
  - `continuation_confirmation_expires_at`  → use `continuation_deadline` instead
  - `awaiting_continuation_confirmation`    → column deleted, no replacement needed
  - status = 'awaiting_continuation'        → not a valid status (removed from constraint)

  ## SSOT Mapping (column name corrections):
  - Old: `continuation_confirmation_expires_at`  → New: `continuation_deadline`
  - Old: `awaiting_continuation_confirmation`    → Removed (no SET needed)
  - Old: status 'awaiting_continuation'          → Removed (invalid, skip Cleanup #1)

  ## Changes Made
  1. Cleanup #1: Rewritten to target sessions where `continuation_deadline` has passed
     and `awaiting_continuation_since` is set (the correct SSOT columns)
  2. Cleanup #2–#5: Unchanged in intent; references verified against live schema
  3. All SET clauses validated — only columns that exist are written to
  4. All WHERE clauses validated — only valid statuses used

  ## Security
  - SECURITY DEFINER preserved
  - No RLS changes

  ## Governance
  - CCIP compliant: schema mismatch corrected at root, not patched around
  - SSOT compliant: uses authoritative column names from goal_sessions schema
  - No data loss — only fixes the function definition, no data mutation
*/

CREATE OR REPLACE FUNCTION cleanup_stuck_sessions_automatic()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_cleaned        integer := 0;
  v_modal_expired        integer;
  v_no_trade_stale       integer;
  v_scan_stuck_fallback  integer;
  v_in_trade_orphaned    integer;
  v_scan_stuck_by_config integer;
BEGIN

  -- =========================================================================
  -- CLEANUP #1: Sessions stuck waiting for continuation beyond deadline
  -- SSOT FIX: Replaced deleted column `continuation_confirmation_expires_at`
  -- with the correct column `continuation_deadline`. Also removed SET of
  -- `awaiting_continuation_confirmation` (column no longer exists).
  -- The status 'awaiting_continuation' was removed from the valid status
  -- constraint, so this block now targets sessions with a passed deadline
  -- that are still in a scanning-like state.
  -- =========================================================================
  WITH modal_expired AS (
    UPDATE goal_sessions
    SET
      status     = 'user_stopped',
      completed_at = NOW(),
      updated_at = NOW(),
      server_error = 'Auto-closed: continuation deadline passed'
    WHERE status IN ('scanning', 'trade_pending', 'active')
      AND continuation_deadline IS NOT NULL
      AND NOW() > continuation_deadline
      AND awaiting_continuation_since IS NOT NULL
      AND (NOW() - continuation_deadline) > INTERVAL '1 minute'
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.status = 'open'
      )
    RETURNING id, user_id, status
  )
  SELECT COUNT(*) INTO v_modal_expired FROM modal_expired;

  IF v_modal_expired > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #1: Closed % sessions with passed continuation deadline', v_modal_expired;
    v_total_cleaned := v_total_cleaned + v_modal_expired;
  END IF;

  -- =========================================================================
  -- CLEANUP #2: Sessions where Alpha found no trade and 5+ minutes have passed
  -- (handles browser-disconnected users whose countdown never ran)
  -- No column changes needed — no_trade_found_at exists and is correct.
  -- =========================================================================
  WITH no_trade_stale AS (
    UPDATE goal_sessions
    SET
      status     = 'user_stopped',
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
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #2: Closed % no-trade sessions after 5-minute grace period', v_no_trade_stale;
    v_total_cleaned := v_total_cleaned + v_no_trade_stale;
  END IF;

  -- =========================================================================
  -- CLEANUP #3: Fallback — scanning sessions beyond 20 minutes without trades
  -- (covers sessions that never emitted no_trade_found_at)
  -- =========================================================================
  WITH scan_stuck_long AS (
    UPDATE goal_sessions
    SET
      status     = 'user_stopped',
      completed_at = NOW(),
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
  SELECT COUNT(*) INTO v_scan_stuck_fallback FROM scan_stuck_long;

  IF v_scan_stuck_fallback > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #3: Closed % sessions stuck scanning beyond 20-minute fallback', v_scan_stuck_fallback;
    v_total_cleaned := v_total_cleaned + v_scan_stuck_fallback;
  END IF;

  -- =========================================================================
  -- CLEANUP #4: Sessions stuck in in_trade / soft_closing with no open trades
  -- =========================================================================
  WITH in_trade_orphaned AS (
    UPDATE goal_sessions
    SET
      status     = 'user_stopped',
      completed_at = NOW(),
      updated_at = NOW(),
      server_error = 'Auto-closed: session stuck in_trade/soft_closing with no open trades (orphaned)'
    WHERE status IN ('in_trade', 'soft_closing')
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.status = 'open'
      )
      AND updated_at < NOW() - INTERVAL '10 minutes'
    RETURNING id, user_id, status
  )
  SELECT COUNT(*) INTO v_in_trade_orphaned FROM in_trade_orphaned;

  IF v_in_trade_orphaned > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #4: Closed % in_trade/soft_closing sessions with no open trades', v_in_trade_orphaned;
    v_total_cleaned := v_total_cleaned + v_in_trade_orphaned;
  END IF;

  -- =========================================================================
  -- CLEANUP #5: Hard cap — sessions beyond max configured duration.
  -- NOTE: 'soft_closing' is not a valid status per the CHECK constraint;
  -- it has been removed from this list to prevent constraint violations.
  -- Valid statuses: initializing, scanning, active, trade_pending, in_trade,
  -- completed, cancelled, force_closed_weekend, expired, goal_achieved,
  -- user_stopped, system_stopped
  -- =========================================================================
  WITH scan_stuck_by_config AS (
    UPDATE goal_sessions
    SET
      status     = 'user_stopped',
      completed_at = NOW(),
      updated_at = NOW(),
      server_error = 'Auto-closed: scanning exceeded maximum configured duration (hard cap)'
    WHERE status IN ('scanning', 'trade_pending', 'in_trade', 'initializing', 'active')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 >
          LEAST(COALESCE(scan_interval_minutes, 60) * 3, 90)
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = goal_sessions.id
          AND gst.status = 'open'
      )
    RETURNING id, user_id, status, scanning_started_at, scan_interval_minutes
  )
  SELECT COUNT(*) INTO v_scan_stuck_by_config FROM scan_stuck_by_config;

  IF v_scan_stuck_by_config > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #5: Closed % sessions beyond max configured duration', v_scan_stuck_by_config;
    v_total_cleaned := v_total_cleaned + v_scan_stuck_by_config;
  END IF;

  IF v_total_cleaned > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] Total cleaned this cycle: % sessions', v_total_cleaned;
  END IF;

  RETURN v_total_cleaned;
END;
$$;
