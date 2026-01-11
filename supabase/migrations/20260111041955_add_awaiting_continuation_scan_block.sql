/*
  # Add Awaiting Continuation Scan Block

  ## Problem
  The can_scan_now() function doesn't check goal_sessions.status field.
  When status='awaiting_continuation', scanning should be blocked.

  ## Fix
  Add status check at the beginning of can_scan_now() to block scanning
  when session is awaiting continuation decision from user.

  ## SSOT
  This ensures scanning respects the continuation modal flow:
  - Entry intent times out → status='awaiting_continuation'
  - Modal shown to user → scanning blocked
  - User decides → status updated → scanning resumes or session closes
*/

CREATE OR REPLACE FUNCTION can_scan_now(
  p_session_id uuid
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_session goal_sessions;
  v_now timestamptz := now();
  v_result jsonb;
  v_time_since_last_scan interval;
  v_time_in_cycle interval;
BEGIN
  -- Get session details
  SELECT * INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'session_not_found',
      'message', 'Goal session not found'
    );
  END IF;

  -- CRITICAL: Block scanning if session is awaiting continuation decision
  IF v_session.status = 'awaiting_continuation' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'awaiting_continuation',
      'message', 'Waiting for your decision: continue scanning or close session',
      'deadline', v_session.continuation_deadline,
      'seconds_remaining', CASE
        WHEN v_session.continuation_deadline IS NOT NULL
        THEN EXTRACT(EPOCH FROM (v_session.continuation_deadline - v_now))::integer
        ELSE 60
      END
    );
  END IF;

  -- Block scanning if session is completed or paused
  IF v_session.status IN ('completed', 'paused', 'stopped') THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'session_not_active',
      'message', format('Session is %s', v_session.status)
    );
  END IF;

  -- Admin bypass
  IF v_session.unlimited_scanning = true THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'admin_bypass',
      'message', 'Admin user - unlimited scanning enabled'
    );
  END IF;

  -- Check if in lockdown
  IF v_session.scanning_cycle_status = 'lockdown' THEN
    IF v_now < v_session.lockdown_ends_at THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'lockdown',
        'message', 'Scanning paused for 12 hours due to unfavorable markets',
        'lockdown_ends_at', v_session.lockdown_ends_at,
        'seconds_remaining', EXTRACT(EPOCH FROM (v_session.lockdown_ends_at - v_now))::integer
      );
    ELSE
      -- Lockdown expired, reset to active
      PERFORM reset_scanning_cycle(p_session_id);
      RETURN jsonb_build_object(
        'allowed', true,
        'reason', 'lockdown_expired',
        'message', 'Lockdown period ended, resuming scanning'
      );
    END IF;
  END IF;

  -- Check if in cooldown
  IF v_session.scanning_cycle_status = 'cooldown' THEN
    IF v_now < v_session.cooldown_ends_at THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'cooldown',
        'message', 'Taking a 15-minute break before next session',
        'cooldown_ends_at', v_session.cooldown_ends_at,
        'seconds_remaining', EXTRACT(EPOCH FROM (v_session.cooldown_ends_at - v_now))::integer,
        'next_session', v_session.scanning_session_number + 1
      );
    ELSE
      -- Cooldown expired, check if we should enter lockdown or next session
      v_time_in_cycle := v_now - v_session.cycle_started_at;

      IF v_time_in_cycle >= interval '2 hours 30 minutes' THEN
        -- Trigger lockdown
        PERFORM trigger_scanning_lockdown(p_session_id);
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'lockdown_triggered',
          'message', 'No trades found after 2.5 hours. Markets unfavorable. Pausing for 12 hours.',
          'lockdown_ends_at', v_now + interval '12 hours'
        );
      ELSE
        -- Start next session
        PERFORM start_next_scanning_session(p_session_id);
        RETURN jsonb_build_object(
          'allowed', true,
          'reason', 'cooldown_expired',
          'message', 'Cooldown complete, starting next session'
        );
      END IF;
    END IF;
  END IF;

  -- Active state - check session time and scan limits
  IF v_session.scanning_cycle_status = 'active' THEN
    -- Check if session time expired (60 minutes)
    IF v_now >= v_session.scanning_session_ends_at THEN
      -- Trigger cooldown
      PERFORM trigger_scanning_cooldown(p_session_id);
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'session_expired',
        'message', 'Session complete. Taking 15-minute break.',
        'cooldown_ends_at', v_now + interval '15 minutes'
      );
    END IF;

    -- Check if max scans reached for this session
    IF v_session.scans_in_current_session >= v_session.max_scans_per_session THEN
      -- Trigger cooldown
      PERFORM trigger_scanning_cooldown(p_session_id);
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'max_scans_reached',
        'message', format('Maximum %s scans completed. Taking 15-minute break.', v_session.max_scans_per_session),
        'cooldown_ends_at', v_now + interval '15 minutes'
      );
    END IF;

    -- Check scan interval (must wait 5 minutes between scans)
    IF v_session.last_scan_at IS NOT NULL THEN
      v_time_since_last_scan := v_now - v_session.last_scan_at;
      IF v_time_since_last_scan < (v_session.scan_interval_seconds || ' seconds')::interval THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'scan_too_soon',
          'message', 'Please wait between scans',
          'next_scan_at', v_session.last_scan_at + (v_session.scan_interval_seconds || ' seconds')::interval,
          'seconds_remaining', v_session.scan_interval_seconds - EXTRACT(EPOCH FROM v_time_since_last_scan)::integer
        );
      END IF;
    END IF;

    -- All checks passed
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'active',
      'message', 'Ready to scan',
      'scans_remaining', v_session.max_scans_per_session - v_session.scans_in_current_session,
      'session_number', v_session.scanning_session_number
    );
  END IF;

  -- Default fallback
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'unknown_state',
    'message', 'Session in unknown state'
  );
END;
$$;

COMMENT ON FUNCTION can_scan_now(uuid) IS
  'Checks if scanning is currently allowed and returns detailed status. Blocks scanning when awaiting continuation decision.';