/*
  # SSOT-Compliant Stuck Session Fixes - Part 2
  # (check_continuation_modal_timeout + cleanup_stuck_sessions_automatic)

  1. SessionTimeoutAuthority - SINGLE source for timeout logic
  2. Eliminates duplicate timeout checks (awaiting_continuation_since is ONLY authority)
  3. Calls cleanup_orphaned_intents to prevent blocking
  4. Governance audit for all auto-close operations
  5. Conflict detection (don't double-close)
*/

-- Fix 3: check_continuation_modal_timeout - SessionTimeoutAuthority
CREATE OR REPLACE FUNCTION check_continuation_modal_timeout()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session goal_sessions;
  v_closed_count integer := 0;
  v_sessions_cursor CURSOR FOR
    SELECT *
    FROM goal_sessions
    WHERE
      status = 'awaiting_continuation'
      AND awaiting_continuation_since IS NOT NULL
      AND NOW() > continuation_deadline
    FOR UPDATE; -- Lock rows to prevent race condition with user action
BEGIN
  -- SSOT AUTHORITY: SessionTimeoutAuthority
  -- RESPONSIBILITY: Auto-close expired continuation timeouts
  -- AUTHORITY SOURCE: awaiting_continuation_since is ONLY timeout authority
  -- NOTE: Removed duplicate safety check (scanning_started_at is NOT authority)

  FOR v_session IN v_sessions_cursor LOOP
    BEGIN
      -- Step 1: Cleanup orphaned intents that might block transition
      PERFORM cleanup_orphaned_intents(v_session.id, 'timeout_auto_close');

      -- Step 2: Transition session to user_stopped
      UPDATE goal_sessions SET
        status = 'user_stopped',
        updated_at = NOW()
      WHERE id = v_session.id;

      -- Step 3: Dismiss any pending modals for this session
      UPDATE pending_user_modals SET
        dismissed_at = NOW()
      WHERE session_id = v_session.id
      AND dismissed_at IS NULL;

      -- Step 4: Create session_ended notification
      BEGIN
        INSERT INTO goal_notifications (
          user_id, session_id, type, title, message, priority, created_at
        )
        VALUES (
          v_session.user_id,
          v_session.id,
          'session_ended',
          'Session Ended',
          'Your session ended due to continuation timeout. Check your results!',
          'high',
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to create session_ended notification: %', SQLERRM;
      END;

      -- Step 5: Create session_ended modal
      BEGIN
        INSERT INTO pending_user_modals (
          user_id, session_id, type, title, message, metadata, created_at
        )
        VALUES (
          v_session.user_id,
          v_session.id,
          'session_ended',
          'Session Ended',
          'Your session ended due to continuation timeout. Would you like to review your trades?',
          jsonb_build_object(
            'reason', 'continuation_timeout',
            'ended_at', NOW()
          ),
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to create session_ended modal: %', SQLERRM;
      END;

      -- Step 6: Audit this auto-close
      INSERT INTO governance_change_log (
        entity_type, entity_id, operation, old_value, new_value,
        reason, requester_id, metadata
      )
      VALUES (
        'goal_sessions',
        v_session.id,
        'status_transition',
        jsonb_build_object('status', v_session.status),
        jsonb_build_object('status', 'user_stopped'),
        'continuation_timeout_auto_close',
        NULL, -- System operation, no requester
        jsonb_build_object(
          'awaiting_since', v_session.awaiting_continuation_since,
          'deadline_was', v_session.continuation_deadline,
          'timeout_duration_seconds', EXTRACT(EPOCH FROM (NOW() - v_session.awaiting_continuation_since))
        )
      );

      v_closed_count := v_closed_count + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Log failure but continue to next session
      INSERT INTO governance_change_log (
        entity_type, entity_id, operation, error_message
      )
      VALUES (
        'goal_sessions',
        v_session.id,
        'check_continuation_modal_timeout_FAILED',
        'Error auto-closing expired continuation: ' || SQLERRM
      );

      RAISE WARNING 'Failed to auto-close session % on timeout: %', v_session.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Closed % sessions due to continuation timeout', v_closed_count;
END;
$$;

-- Fix 4: cleanup_stuck_sessions_automatic - SessionTimeoutAuthority
CREATE OR REPLACE FUNCTION cleanup_stuck_sessions_automatic()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session goal_sessions;
  v_closed_count integer := 0;
  v_cleanup_result jsonb;
  v_stuck_sessions CURSOR FOR
    SELECT *
    FROM goal_sessions
    WHERE (
      (
        -- Stuck in awaiting_continuation for >5 minutes beyond deadline
        status = 'awaiting_continuation'
        AND continuation_deadline IS NOT NULL
        AND NOW() > (continuation_deadline + interval '5 minutes')
      )
      OR (
        -- Stuck in scanning for >35 minutes without recent activity
        status IN ('scanning', 'trade_pending')
        AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) > 2100 -- 35 minutes
        AND NOT EXISTS (
          SELECT 1 FROM goal_session_trades
          WHERE session_id = goal_sessions.id
          AND created_at > (NOW() - interval '5 minutes')
        )
      )
    )
    FOR UPDATE;
BEGIN
  -- SSOT AUTHORITY: SessionTimeoutAuthority
  -- RESPONSIBILITY: Auto-detect and cleanup stuck sessions
  -- THOROUGHNESS: Cleanup orphaned intents, modals, and notify user

  FOR v_session IN v_stuck_sessions LOOP
    BEGIN
      -- Step 1: Cleanup orphaned intents
      v_cleanup_result := cleanup_orphaned_intents(v_session.id, 'stuck_session_cleanup');

      -- Step 2: Dismiss all pending modals
      UPDATE pending_user_modals SET
        dismissed_at = NOW()
      WHERE session_id = v_session.id
      AND dismissed_at IS NULL;

      -- Step 3: Close any open trades (graceful closure)
      -- Note: This should be delegated to TradeClosureCoordinator in production
      -- For now, mark trades as closed due to system timeout
      UPDATE goal_session_trades SET
        status = 'closed',
        close_reason = 'system_timeout_force_close',
        closed_at = NOW()
      WHERE session_id = v_session.id
      AND status IN ('open', 'pending');

      -- Step 4: Transition session to user_stopped
      UPDATE goal_sessions SET
        status = 'user_stopped',
        updated_at = NOW()
      WHERE id = v_session.id;

      -- Step 5: Create session_ended modal and notification
      BEGIN
        INSERT INTO pending_user_modals (
          user_id, session_id, type, title, message, metadata, created_at
        )
        VALUES (
          v_session.user_id,
          v_session.id,
          'session_ended',
          'Session Ended',
          'Your session was automatically ended due to inactivity. Review your trades and feedback below.',
          jsonb_build_object(
            'reason', 'stuck_session_cleanup',
            'ended_at', NOW()
          ),
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to create session_ended modal for stuck session: %', SQLERRM;
      END;

      BEGIN
        INSERT INTO goal_notifications (
          user_id, session_id, type, title, message, priority, created_at
        )
        VALUES (
          v_session.user_id,
          v_session.id,
          'session_ended',
          'Session Auto-Ended',
          'Your session was automatically ended due to inactivity or timeout.',
          'critical',
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to create session_ended notification: %', SQLERRM;
      END;

      -- Step 6: Log recovery attempt in recovery log
      INSERT INTO stuck_session_recovery_log (
        session_id, stuck_reason, cleanup_attempted_at, cleanup_status,
        recovery_function, metadata, resolved_at
      )
      VALUES (
        v_session.id,
        CASE
          WHEN v_session.status = 'awaiting_continuation' THEN 'timeout_not_triggered'
          ELSE 'incomplete_closure'
        END,
        NOW(),
        'success',
        'cleanup_stuck_sessions_automatic',
        jsonb_build_object(
          'previous_status', v_session.status,
          'orphaned_intents_cleaned', v_cleanup_result->>'abandoned_count',
          'duration_in_state', EXTRACT(EPOCH FROM (NOW() - v_session.scanning_started_at))
        ),
        NOW()
      );

      -- Step 7: Governance audit
      INSERT INTO governance_change_log (
        entity_type, entity_id, operation, old_value, new_value,
        reason, metadata
      )
      VALUES (
        'goal_sessions',
        v_session.id,
        'status_transition',
        jsonb_build_object('status', v_session.status),
        jsonb_build_object('status', 'user_stopped'),
        'stuck_session_auto_cleanup',
        jsonb_build_object(
          'previous_status', v_session.status,
          'reason', CASE
            WHEN v_session.status = 'awaiting_continuation' THEN 'timeout_not_manually_triggered'
            ELSE 'inactivity_limit_exceeded'
          END,
          'cleanup_details', v_cleanup_result
        )
      );

      v_closed_count := v_closed_count + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Log failure and continue
      INSERT INTO governance_change_log (
        entity_type, entity_id, operation, error_message
      )
      VALUES (
        'goal_sessions',
        v_session.id,
        'cleanup_stuck_sessions_FAILED',
        'Error cleaning up stuck session: ' || SQLERRM
      );

      INSERT INTO stuck_session_recovery_log (
        session_id, stuck_reason, cleanup_attempted_at, cleanup_status,
        cleanup_error_message, recovery_function
      )
      VALUES (
        v_session.id,
        'incomplete_cleanup',
        NOW(),
        'failed',
        SQLERRM,
        'cleanup_stuck_sessions_automatic'
      );

      RAISE WARNING 'Failed to cleanup stuck session %: %', v_session.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Cleaned up % stuck sessions', v_closed_count;
  RETURN v_closed_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Exception in cleanup_stuck_sessions_automatic: %', SQLERRM;
  RETURN 0;
END;
$$;

-- Create cron job to run cleanup every 5 minutes
-- (Assumes pg_cron extension is available)
DO $$
BEGIN
  -- This is a placeholder - actual cron setup depends on infrastructure
  RAISE NOTICE 'Remember to schedule: SELECT cron.schedule(''cleanup-stuck-sessions'', ''*/5 * * * *'', ''SELECT cleanup_stuck_sessions_automatic()'')';
END $$;
