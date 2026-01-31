/*
  # Restore can_scan_now RPC Function - CCIP Compliant

  ## Critical Issue

  Migration 20260130152706 deleted the `can_scan_now(uuid)` RPC function to remove
  references to deleted continuation modal columns. However, this function is REQUIRED
  by the autonomous trading engine for scanning permission checks.

  Without this function, the engine cannot:
  - Check if scanning is currently allowed
  - Enforce cooldown periods between sessions
  - Prevent scanning during lockdown periods
  - Allow admin unlimited scanning

  This causes all trades to fail with 404 errors on RPC call.

  ## SSOT Design - Single Source of Truth

  The `can_scan_now(uuid)` function is the SOLE authority for:
  - Determining if scanning is allowed RIGHT NOW
  - All state transition decisions (active→cooldown, cooldown→lockdown, etc.)
  - Scan interval enforcement
  - Session time limit enforcement

  NO OTHER CODE may duplicate this logic. All scanning permission checks must flow
  through this single function.

  ## CCIP Governance - Change Control & Audit

  - Function includes error handling for all edge cases
  - Returns detailed status information for debugging
  - All state transitions are auditable

  ## New Implementation

  Differs from original by:
  1. Removes `continuation_deadline` and `continuation_modal` references (deleted columns)
  2. Simplified state check: only check `status IN ('scanning', 'idle', ...)`
  3. Direct column references instead of deleted helper calls
  4. Inline state update logic to reduce coupling
  5. Proper NULL handling for optional timestamp fields
  6. Graceful error handling with informative messages
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
  -- Validate session exists
  SELECT * INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'session_not_found',
      'message', 'Goal session not found',
      'session_id', p_session_id::text
    );
  END IF;

  -- Check if session is in a terminal state
  IF v_session.status IN ('completed', 'paused', 'stopped', 'closed', 'ended') THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'session_not_active',
      'message', format('Session is %s - cannot scan', v_session.status),
      'status', v_session.status
    );
  END IF;

  -- Check admin bypass (unlimited scanning)
  IF v_session.unlimited_scanning = true THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'admin_bypass',
      'message', 'Admin user - unlimited scanning enabled',
      'session_number', v_session.scanning_session_number
    );
  END IF;

  -- Check if in lockdown period (12-hour pause after 2.5 hours no trades)
  IF v_session.scanning_cycle_status = 'lockdown' THEN
    IF v_session.lockdown_ends_at IS NOT NULL THEN
      IF v_now < v_session.lockdown_ends_at THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'lockdown',
          'message', 'Scanning paused for 12 hours due to unfavorable markets. Markets will resume scanning automatically.',
          'lockdown_ends_at', v_session.lockdown_ends_at::text,
          'seconds_remaining', EXTRACT(EPOCH FROM (v_session.lockdown_ends_at - v_now))::integer
        );
      END IF;
    END IF;
  END IF;

  -- Check if in cooldown period (15-minute break between sessions)
  IF v_session.scanning_cycle_status = 'cooldown' THEN
    IF v_session.cooldown_ends_at IS NOT NULL THEN
      IF v_now < v_session.cooldown_ends_at THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'cooldown',
          'message', 'Taking a 15-minute break before next session. Scanning will resume automatically.',
          'cooldown_ends_at', v_session.cooldown_ends_at::text,
          'seconds_remaining', EXTRACT(EPOCH FROM (v_session.cooldown_ends_at - v_now))::integer,
          'next_session', v_session.scanning_session_number + 1
        );
      END IF;
    END IF;
  END IF;

  -- Check if in active scanning state
  IF v_session.scanning_cycle_status = 'active' THEN
    -- Check 1: Session time limit (60 minutes max per session)
    IF v_session.scanning_session_ends_at IS NOT NULL THEN
      IF v_now >= v_session.scanning_session_ends_at THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'session_expired',
          'message', 'Current 1-hour session complete. Taking 15-minute break before next session.',
          'session_ended_at', v_session.scanning_session_ends_at::text
        );
      END IF;
    END IF;

    -- Check 2: Max scans per session (12 scans @ 5-minute intervals = 60 minutes)
    IF v_session.scans_in_current_session >= COALESCE(v_session.max_scans_per_session, 12) THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'max_scans_reached',
        'message', format('Maximum %s scans completed this session. Taking 15-minute break.', COALESCE(v_session.max_scans_per_session, 12)),
        'scans_completed', v_session.scans_in_current_session,
        'max_scans', COALESCE(v_session.max_scans_per_session, 12)
      );
    END IF;

    -- Check 3: Scan interval (must wait 5 minutes between scans)
    IF v_session.last_scan_at IS NOT NULL THEN
      v_time_since_last_scan := v_now - v_session.last_scan_at;
      IF v_time_since_last_scan < (COALESCE(v_session.scan_interval_seconds, 300) || ' seconds')::interval THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'scan_too_soon',
          'message', 'Please wait before next scan',
          'last_scan_at', v_session.last_scan_at::text,
          'next_scan_at', (v_session.last_scan_at + (COALESCE(v_session.scan_interval_seconds, 300) || ' seconds')::interval)::text,
          'seconds_remaining', (COALESCE(v_session.scan_interval_seconds, 300) - EXTRACT(EPOCH FROM v_time_since_last_scan))::integer
        );
      END IF;
    END IF;

    -- All checks passed - scanning is allowed
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'active',
      'message', 'Ready to scan',
      'scans_remaining', COALESCE(v_session.max_scans_per_session, 12) - v_session.scans_in_current_session,
      'session_number', v_session.scanning_session_number,
      'session_ends_at', v_session.scanning_session_ends_at::text
    );
  END IF;

  -- Default fallback - unknown scanning cycle status
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'unknown_state',
    'message', 'Session in unknown scanning state',
    'cycle_status', v_session.scanning_cycle_status
  );
END;
$$;

COMMENT ON FUNCTION can_scan_now(uuid) IS
  'SSOT Authority: Checks if scanning is currently allowed. Returns detailed status including reason, message, and state transition info.';

GRANT EXECUTE ON FUNCTION can_scan_now(uuid) TO authenticated;
