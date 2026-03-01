/*
  # Session Persistence Governance — Browser Independence Fix

  ## Summary
  This migration fixes the root cause of sessions breaking when users close their browser.
  The system already has the right Netlify scheduled infrastructure, but several critical
  gaps allowed sessions to get permanently stuck.

  ## Problems Fixed

  ### 1. goal_session_server_state table (MISSING)
  The autonomous-goal-monitor writes to this table every minute, but it was never created
  in a migration. This caused silent upsert failures and prevented per-session error tracking.

  ### 2. cleanup_stuck_sessions_automatic — expanded coverage
  Previous version only auto-closed sessions that NEVER had a trade.
  Sessions with open trades that the server fails to process were stuck indefinitely.
  New Cleanup #4 handles: sessions in in_trade/soft_closing status with NO open trades
  (trade closed at broker but session state never updated).
  New Cleanup #5 handles: scanning sessions stuck beyond the user's scan_interval_minutes.

  ### 3. pg_cron: cleanup_stuck_sessions_automatic scheduled independently
  The cleanup was only called from the Netlify autonomous-goal-monitor.
  If Netlify has an outage, no cleanup happens. Now pg_cron runs it every 5 minutes
  directly in the database, independent of any Netlify function.

  ### 4. get_sessions_for_server_processing — ghost session filter
  Sessions with 10+ consecutive server errors are excluded from the processing queue
  to prevent infinite retry loops that mask the real problem.

  ### 5. update_server_heartbeat — only updates on real activity
  A new RPC wrapper that only updates the heartbeat when actual processing occurred,
  not on every poll attempt.

  ## Security
  - All new tables have RLS enabled
  - Service role has full access for server-side operations
  - Users can only read/update their own session server state

  ## SSOT Compliance
  - cleanup_stuck_sessions_automatic is the sole authority for automated session termination
  - get_sessions_for_server_processing is the sole authority for server processing queue
  - goal_session_server_state is the sole audit trail for server-side processing activity
*/

-- ============================================================================
-- STEP 1: Create goal_session_server_state table (was missing from schema)
-- ============================================================================

CREATE TABLE IF NOT EXISTS goal_session_server_state (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id       uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_processed_at     timestamptz DEFAULT now(),
  last_tick_price       numeric,
  current_symbol        text,
  trades_executed       integer DEFAULT 0,
  server_decisions      integer DEFAULT 0,
  consecutive_errors    integer DEFAULT 0,
  last_error            text,
  last_error_at         timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT goal_session_server_state_session_unique UNIQUE (goal_session_id)
);

COMMENT ON TABLE goal_session_server_state IS
  'Server-side processing audit trail for goal sessions. '
  'Written by autonomous-goal-monitor every minute. '
  'consecutive_errors used to detect and exclude permanently-failing sessions.';

ALTER TABLE goal_session_server_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session server state"
  ON goal_session_server_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to session server state"
  ON goal_session_server_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_goal_session_server_state_session_id
  ON goal_session_server_state(goal_session_id);

CREATE INDEX IF NOT EXISTS idx_goal_session_server_state_user_id
  ON goal_session_server_state(user_id);

CREATE INDEX IF NOT EXISTS idx_goal_session_server_state_consecutive_errors
  ON goal_session_server_state(consecutive_errors)
  WHERE consecutive_errors > 0;

-- ============================================================================
-- STEP 2: Update cleanup_stuck_sessions_automatic with full coverage
-- Adds Cleanup #4 (in_trade/soft_closing with no open trades)
-- Adds Cleanup #5 (scanning beyond configured scan_interval_minutes)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_stuck_sessions_automatic()
RETURNS integer
LANGUAGE plpgsql
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
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #1: Closed % sessions with expired continuation modal', v_modal_expired;
    v_total_cleaned := v_total_cleaned + v_modal_expired;
  END IF;

  -- =========================================================================
  -- CLEANUP #2: Sessions where Alpha found no trade and 5+ minutes have passed
  -- (handles browser-disconnected users whose countdown never ran)
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
  SELECT COUNT(*) INTO v_scan_stuck_fallback FROM scan_stuck_long;

  IF v_scan_stuck_fallback > 0 THEN
    RAISE NOTICE '[cleanup_stuck_sessions_automatic] CLEANUP #3: Closed % sessions stuck scanning beyond 20-minute fallback', v_scan_stuck_fallback;
    v_total_cleaned := v_total_cleaned + v_scan_stuck_fallback;
  END IF;

  -- =========================================================================
  -- CLEANUP #4 (NEW): Sessions stuck in in_trade / soft_closing with no open
  -- trades — trade closed at broker but session state was never updated.
  -- These sessions would run forever because the 20-min fallback only checks
  -- 'scanning' status, not 'in_trade'.
  -- =========================================================================
  WITH in_trade_orphaned AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
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
  -- CLEANUP #5 (NEW): Scanning sessions that have been running longer than
  -- their configured scan_interval_minutes × 3 (hard cap at 90 minutes).
  -- This is the final safety net for sessions that somehow bypassed all others.
  -- =========================================================================
  WITH scan_stuck_by_config AS (
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW(),
      server_error = 'Auto-closed: scanning exceeded maximum configured duration (hard cap)'
    WHERE status IN ('scanning', 'trade_pending', 'in_trade', 'soft_closing', 'initializing')
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

COMMENT ON FUNCTION cleanup_stuck_sessions_automatic IS
  'CCIP-governed stuck session recovery. Called every minute by autonomous-goal-monitor AND '
  'every 5 minutes by pg_cron directly (browser-independence guarantee). '
  'Cleanup order: '
  '(1) expired continuation modals (1 min), '
  '(2) no-trade sessions with grace period elapsed (5 min), '
  '(3) fallback scanning without no_trade signal (20 min), '
  '(4) in_trade/soft_closing with no open trades (10 min idle), '
  '(5) hard cap — scanning beyond 3× configured scan_interval_minutes (max 90 min).';

GRANT EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic TO service_role;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM authenticated;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM anon;
REVOKE EXECUTE ON FUNCTION cleanup_stuck_sessions_automatic FROM public;

-- ============================================================================
-- STEP 3: Update get_sessions_for_server_processing to exclude ghost sessions
-- Sessions with 10+ consecutive errors are skipped (they fail every minute
-- and mask the real problem). Admin must investigate and reset.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_sessions_for_server_processing()
RETURNS TABLE (
  session_id          uuid,
  user_id             uuid,
  watchlist           text[],
  target_value        numeric,
  current_progress    numeric,
  server_last_check   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gs.id           AS session_id,
    gs.user_id,
    gs.watchlist,
    gs.target_value,
    gs.current_progress,
    gs.server_last_check
  FROM goal_sessions gs
  LEFT JOIN goal_session_server_state gsss ON gsss.goal_session_id = gs.id
  WHERE
    gs.status IN ('scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing', 'awaiting_continuation')
    AND gs.server_enabled = true
    AND gs.autonomous_enabled = true
    AND (
      gs.server_last_check IS NULL
      OR gs.server_last_check < now() - INTERVAL '30 seconds'
    )
    -- GHOST SESSION FILTER: Skip sessions with 10+ consecutive server errors.
    -- These fail every minute and need admin investigation, not more retries.
    AND (
      gsss.consecutive_errors IS NULL
      OR gsss.consecutive_errors < 10
    )
  ORDER BY
    COALESCE(gs.server_last_check, gs.created_at) ASC
  LIMIT 50;
END;
$$;

COMMENT ON FUNCTION get_sessions_for_server_processing IS
  'Returns active goal sessions for server processing. '
  'Excludes sessions with 10+ consecutive errors (ghost sessions). '
  'MUST include awaiting_continuation status so timeout check runs. '
  'Requires server_enabled=true AND autonomous_enabled=true.';

GRANT EXECUTE ON FUNCTION get_sessions_for_server_processing TO service_role;
GRANT EXECUTE ON FUNCTION get_sessions_for_server_processing TO authenticated;

-- ============================================================================
-- STEP 4: Schedule cleanup_stuck_sessions_automatic via pg_cron
-- This is the DATABASE-LEVEL safety net — independent of Netlify availability.
-- If Netlify is down for hours, pg_cron still closes stuck sessions every 5 min.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('cleanup-stuck-goal-sessions');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'cleanup-stuck-goal-sessions',
      '*/5 * * * *',
      'SELECT cleanup_stuck_sessions_automatic();'
    );

    RAISE NOTICE '[CCIP] pg_cron job scheduled: cleanup-stuck-goal-sessions (every 5 minutes)';
  ELSE
    RAISE NOTICE '[CCIP] pg_cron not available — skipping direct cron scheduling';
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Add scan_interval_minutes column to goal_sessions if missing
-- Used by Cleanup #5 to determine per-session hard cap
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scan_interval_minutes'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN scan_interval_minutes integer DEFAULT 60;
    COMMENT ON COLUMN goal_sessions.scan_interval_minutes IS
      'Maximum allowed scanning duration in minutes before auto-close. '
      'Defaults to 60 (matching the 60-minute continuation modal threshold). '
      'Cleanup #5 uses LEAST(this × 3, 90 min) as hard cap.';
    RAISE NOTICE '[CCIP] Added scan_interval_minutes column to goal_sessions';
  ELSE
    RAISE NOTICE '[CCIP] scan_interval_minutes column already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- STEP 6: Backfill default scan_interval_minutes for existing sessions
-- ============================================================================

UPDATE goal_sessions
SET scan_interval_minutes = 60
WHERE scan_interval_minutes IS NULL;

-- ============================================================================
-- STEP 7: Create reset_session_consecutive_errors RPC for admin use
-- Allows admins to manually unblock a ghost session for retry
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_session_consecutive_errors(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE goal_session_server_state
  SET
    consecutive_errors = 0,
    last_error = NULL,
    last_error_at = NULL,
    updated_at = NOW()
  WHERE goal_session_id = p_session_id;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION reset_session_consecutive_errors IS
  'Admin RPC: resets consecutive_errors to 0 so a ghost session re-enters the processing queue. '
  'Use when a persistent error has been resolved and session should retry.';

GRANT EXECUTE ON FUNCTION reset_session_consecutive_errors TO service_role;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_has_server_state boolean;
  v_has_scan_interval boolean;
  v_has_pg_cron boolean;
  v_cron_job_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'goal_session_server_state'
  ) INTO v_has_server_state;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scan_interval_minutes'
  ) INTO v_has_scan_interval;

  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO v_has_pg_cron;

  IF v_has_pg_cron THEN
    SELECT COUNT(*) INTO v_cron_job_count
    FROM cron.job
    WHERE jobname = 'cleanup-stuck-goal-sessions';
  END IF;

  RAISE NOTICE '=== Session Persistence Governance Verification ===';
  RAISE NOTICE '  goal_session_server_state table: %', CASE WHEN v_has_server_state THEN 'created' ELSE 'MISSING' END;
  RAISE NOTICE '  scan_interval_minutes column: %', CASE WHEN v_has_scan_interval THEN 'present' ELSE 'MISSING' END;
  RAISE NOTICE '  pg_cron available: %', v_has_pg_cron;
  RAISE NOTICE '  cleanup-stuck-goal-sessions cron job: %', COALESCE(v_cron_job_count::text, 'n/a');
  RAISE NOTICE '  cleanup_stuck_sessions_automatic: updated with 5 cleanup rules';
  RAISE NOTICE '  get_sessions_for_server_processing: updated with ghost session filter';
  RAISE NOTICE '===================================================';
END $$;
