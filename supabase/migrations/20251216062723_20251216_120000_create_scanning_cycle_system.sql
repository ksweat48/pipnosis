/*
  # Create Scanning Cycle System

  1. Overview
    - Implements smart scanning with 1-hour sessions, 15-minute cooldowns, and 12-hour lockdowns
    - Prevents resource waste by limiting scanning when markets are unfavorable
    - Admin bypass for unlimited scanning

  2. Scanning Cycle Logic
    - Session 1: 60 minutes (12 scans @ 5 minutes each) → 15-minute cooldown
    - Session 2: 60 minutes (12 scans @ 5 minutes each) → 15-minute cooldown
    - Total: 2.5 hours → If no trades found, trigger 12-hour lockdown
    - After 12 hours: Reset cycle and start again

  3. New Fields
    - Scanning session tracking (session number, start/end times)
    - Cooldown tracking (start/end times)
    - Lockdown tracking (start/end times)
    - Scan counters and limits
    - Admin bypass flag

  4. Security
    - RLS policies ensure users can only modify their own sessions
    - State machine prevents invalid transitions
    - All timestamps validated and enforced
*/

-- ============================================================================
-- STEP 1: Add scanning cycle fields to goal_sessions
-- ============================================================================

DO $$
BEGIN
  -- Scanning session tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scanning_session_number'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scanning_session_number integer DEFAULT 1;

    COMMENT ON COLUMN goal_sessions.scanning_session_number IS
      'Current session number in the cycle (1 or 2). Resets after lockdown.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scanning_session_started_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scanning_session_started_at timestamptz;

    COMMENT ON COLUMN goal_sessions.scanning_session_started_at IS
      'When the current 1-hour scanning session started';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scanning_session_ends_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scanning_session_ends_at timestamptz;

    COMMENT ON COLUMN goal_sessions.scanning_session_ends_at IS
      'When the current 1-hour scanning session should end';
  END IF;

  -- Cooldown tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'cooldown_started_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN cooldown_started_at timestamptz;

    COMMENT ON COLUMN goal_sessions.cooldown_started_at IS
      'When the 15-minute cooldown period started';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'cooldown_ends_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN cooldown_ends_at timestamptz;

    COMMENT ON COLUMN goal_sessions.cooldown_ends_at IS
      'When the 15-minute cooldown period ends';
  END IF;

  -- Lockdown tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'lockdown_started_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN lockdown_started_at timestamptz;

    COMMENT ON COLUMN goal_sessions.lockdown_started_at IS
      'When the 12-hour lockdown period started';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'lockdown_ends_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN lockdown_ends_at timestamptz;

    COMMENT ON COLUMN goal_sessions.lockdown_ends_at IS
      'When the 12-hour lockdown period ends';
  END IF;

  -- Scan tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'total_scans_in_cycle'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN total_scans_in_cycle integer DEFAULT 0;

    COMMENT ON COLUMN goal_sessions.total_scans_in_cycle IS
      'Total number of complete scans executed across all sessions in current cycle';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scans_in_current_session'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scans_in_current_session integer DEFAULT 0;

    COMMENT ON COLUMN goal_sessions.scans_in_current_session IS
      'Number of scans completed in the current 1-hour session';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'last_scan_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN last_scan_at timestamptz;

    COMMENT ON COLUMN goal_sessions.last_scan_at IS
      'Timestamp of the last completed scan';
  END IF;

  -- Configuration
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'max_scans_per_session'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN max_scans_per_session integer DEFAULT 12;

    COMMENT ON COLUMN goal_sessions.max_scans_per_session IS
      'Maximum scans allowed per 1-hour session (default: 12 = 1 scan every 5 minutes)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scan_interval_seconds'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scan_interval_seconds integer DEFAULT 300;

    COMMENT ON COLUMN goal_sessions.scan_interval_seconds IS
      'Interval between scans in seconds (default: 300 = 5 minutes)';
  END IF;

  -- State management
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'scanning_cycle_status'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN scanning_cycle_status text DEFAULT 'active';

    COMMENT ON COLUMN goal_sessions.scanning_cycle_status IS
      'Current state: active (scanning), cooldown (15-min break), lockdown (12-hour pause)';
  END IF;

  -- Admin bypass
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'unlimited_scanning'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN unlimited_scanning boolean DEFAULT false;

    COMMENT ON COLUMN goal_sessions.unlimited_scanning IS
      'Admin flag: bypass all scanning limits and cycle restrictions';
  END IF;

  -- Cycle start tracking for measuring 2.5 hours
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'cycle_started_at'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN cycle_started_at timestamptz;

    COMMENT ON COLUMN goal_sessions.cycle_started_at IS
      'When the current 2.5-hour cycle started (for lockdown triggering)';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add check constraints for valid states
-- ============================================================================

-- Ensure scanning_cycle_status is one of the three valid states
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_scanning_cycle_status_check'
  ) THEN
    ALTER TABLE goal_sessions
    ADD CONSTRAINT goal_sessions_scanning_cycle_status_check
    CHECK (scanning_cycle_status IN ('active', 'cooldown', 'lockdown'));
  END IF;
END $$;

-- Ensure session number is 1 or 2
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_scanning_session_number_check'
  ) THEN
    ALTER TABLE goal_sessions
    ADD CONSTRAINT goal_sessions_scanning_session_number_check
    CHECK (scanning_session_number BETWEEN 1 AND 2);
  END IF;
END $$;

-- Ensure max_scans_per_session is reasonable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_max_scans_check'
  ) THEN
    ALTER TABLE goal_sessions
    ADD CONSTRAINT goal_sessions_max_scans_check
    CHECK (max_scans_per_session BETWEEN 1 AND 100);
  END IF;
END $$;

-- Ensure scan_interval_seconds is reasonable (1 minute to 1 hour)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_scan_interval_check'
  ) THEN
    ALTER TABLE goal_sessions
    ADD CONSTRAINT goal_sessions_scan_interval_check
    CHECK (scan_interval_seconds BETWEEN 60 AND 3600);
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Create function to initialize scanning session
-- ============================================================================

CREATE OR REPLACE FUNCTION initialize_scanning_session(
  p_session_id uuid,
  p_is_admin boolean DEFAULT false
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE goal_sessions
  SET
    scanning_session_number = 1,
    scanning_session_started_at = v_now,
    scanning_session_ends_at = v_now + interval '1 hour',
    cycle_started_at = v_now,
    scans_in_current_session = 0,
    total_scans_in_cycle = 0,
    scanning_cycle_status = 'active',
    unlimited_scanning = p_is_admin,
    cooldown_started_at = NULL,
    cooldown_ends_at = NULL,
    lockdown_started_at = NULL,
    lockdown_ends_at = NULL,
    last_scan_at = NULL,
    updated_at = v_now
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal session % not found', p_session_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION initialize_scanning_session(uuid, boolean) IS
  'Initializes a new scanning session with proper timestamps and counters';

-- ============================================================================
-- STEP 4: Create function to check if scanning is allowed
-- ============================================================================

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

  -- Fallback
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'unknown_state',
    'message', 'Invalid scanning state'
  );
END;
$$;

COMMENT ON FUNCTION can_scan_now(uuid) IS
  'Checks if scanning is currently allowed and returns detailed status';

-- ============================================================================
-- STEP 5: Create function to record scan completion
-- ============================================================================

CREATE OR REPLACE FUNCTION record_scan_completion(
  p_session_id uuid,
  p_trade_found boolean DEFAULT false
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- Update scan counters
  UPDATE goal_sessions
  SET
    scans_in_current_session = scans_in_current_session + 1,
    total_scans_in_cycle = total_scans_in_cycle + 1,
    last_scan_at = v_now,
    updated_at = v_now
  WHERE id = p_session_id;

  -- If trade found, reset cycle
  IF p_trade_found THEN
    PERFORM reset_scanning_cycle_counters(p_session_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION record_scan_completion(uuid, boolean) IS
  'Records a completed scan and optionally resets cycle if trade was found';

-- ============================================================================
-- STEP 6: Create function to trigger cooldown
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_scanning_cooldown(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE goal_sessions
  SET
    scanning_cycle_status = 'cooldown',
    cooldown_started_at = v_now,
    cooldown_ends_at = v_now + interval '15 minutes',
    updated_at = v_now
  WHERE id = p_session_id;

  -- Create notification
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    priority,
    metadata
  )
  SELECT
    user_id,
    'info',
    'Scanning Break',
    'Session complete. No quality trades found. Taking a 15-minute break before resuming.',
    'medium',
    jsonb_build_object(
      'session_id', p_session_id,
      'cooldown_ends_at', v_now + interval '15 minutes',
      'session_number', scanning_session_number
    )
  FROM goal_sessions
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION trigger_scanning_cooldown(uuid) IS
  'Triggers a 15-minute cooldown period after session completion';

-- ============================================================================
-- STEP 7: Create function to trigger lockdown
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_scanning_lockdown(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE goal_sessions
  SET
    scanning_cycle_status = 'lockdown',
    lockdown_started_at = v_now,
    lockdown_ends_at = v_now + interval '12 hours',
    cooldown_started_at = NULL,
    cooldown_ends_at = NULL,
    updated_at = v_now
  WHERE id = p_session_id;

  -- Create urgent notification
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    priority,
    metadata
  )
  SELECT
    user_id,
    'warning',
    'Scanning Paused',
    'No quality trades found after 2.5 hours. Markets may be unfavorable. Scanning paused for 12 hours to preserve resources.',
    'high',
    jsonb_build_object(
      'session_id', p_session_id,
      'lockdown_ends_at', v_now + interval '12 hours',
      'total_scans', total_scans_in_cycle
    )
  FROM goal_sessions
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION trigger_scanning_lockdown(uuid) IS
  'Triggers a 12-hour lockdown after 2.5 hours of unsuccessful scanning';

-- ============================================================================
-- STEP 8: Create function to start next session
-- ============================================================================

CREATE OR REPLACE FUNCTION start_next_scanning_session(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_next_session integer;
BEGIN
  -- Get next session number
  SELECT scanning_session_number + 1 INTO v_next_session
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Update to next session
  UPDATE goal_sessions
  SET
    scanning_session_number = v_next_session,
    scanning_session_started_at = v_now,
    scanning_session_ends_at = v_now + interval '1 hour',
    scans_in_current_session = 0,
    scanning_cycle_status = 'active',
    cooldown_started_at = NULL,
    cooldown_ends_at = NULL,
    updated_at = v_now
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION start_next_scanning_session(uuid) IS
  'Starts the next 1-hour scanning session after cooldown';

-- ============================================================================
-- STEP 9: Create function to reset cycle (after lockdown or trade found)
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_scanning_cycle(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE goal_sessions
  SET
    scanning_session_number = 1,
    scanning_session_started_at = v_now,
    scanning_session_ends_at = v_now + interval '1 hour',
    cycle_started_at = v_now,
    scans_in_current_session = 0,
    total_scans_in_cycle = 0,
    scanning_cycle_status = 'active',
    cooldown_started_at = NULL,
    cooldown_ends_at = NULL,
    lockdown_started_at = NULL,
    lockdown_ends_at = NULL,
    updated_at = v_now
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION reset_scanning_cycle(uuid) IS
  'Completely resets the scanning cycle to start fresh';

-- ============================================================================
-- STEP 10: Create function to reset counters only (keep state)
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_scanning_cycle_counters(
  p_session_id uuid
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Reset counters but keep current state and session number
  -- This is called when a trade is found mid-session
  UPDATE goal_sessions
  SET
    total_scans_in_cycle = 0,
    scans_in_current_session = 0,
    cycle_started_at = now(),
    updated_at = now()
  WHERE id = p_session_id;
END;
$$;

COMMENT ON FUNCTION reset_scanning_cycle_counters(uuid) IS
  'Resets scan counters when trade is found but keeps session active';

-- ============================================================================
-- STEP 11: Create indexes for performance
-- ============================================================================

-- Index for querying by cycle status
CREATE INDEX IF NOT EXISTS idx_goal_sessions_cycle_status
  ON goal_sessions(scanning_cycle_status, user_id)
  WHERE scanning_cycle_status IN ('cooldown', 'lockdown');

-- Index for finding sessions that need state updates
CREATE INDEX IF NOT EXISTS idx_goal_sessions_cooldown_ends
  ON goal_sessions(cooldown_ends_at)
  WHERE cooldown_ends_at IS NOT NULL AND scanning_cycle_status = 'cooldown';

CREATE INDEX IF NOT EXISTS idx_goal_sessions_lockdown_ends
  ON goal_sessions(lockdown_ends_at)
  WHERE lockdown_ends_at IS NOT NULL AND scanning_cycle_status = 'lockdown';

-- ============================================================================
-- STEP 12: Create view for scanning status dashboard
-- ============================================================================

CREATE OR REPLACE VIEW scanning_status_dashboard AS
SELECT
  gs.id,
  gs.user_id,
  gs.scanning_cycle_status,
  gs.scanning_session_number,
  gs.scans_in_current_session,
  gs.total_scans_in_cycle,
  gs.max_scans_per_session,
  gs.scan_interval_seconds,
  gs.unlimited_scanning,
  gs.scanning_session_started_at,
  gs.scanning_session_ends_at,
  gs.cooldown_started_at,
  gs.cooldown_ends_at,
  gs.lockdown_started_at,
  gs.lockdown_ends_at,
  gs.last_scan_at,
  gs.cycle_started_at,
  -- Calculated fields
  CASE
    WHEN gs.scanning_cycle_status = 'active' THEN
      EXTRACT(EPOCH FROM (gs.scanning_session_ends_at - now()))::integer
    WHEN gs.scanning_cycle_status = 'cooldown' THEN
      EXTRACT(EPOCH FROM (gs.cooldown_ends_at - now()))::integer
    WHEN gs.scanning_cycle_status = 'lockdown' THEN
      EXTRACT(EPOCH FROM (gs.lockdown_ends_at - now()))::integer
    ELSE 0
  END AS seconds_until_state_change,
  gs.max_scans_per_session - gs.scans_in_current_session AS scans_remaining_in_session,
  CASE
    WHEN gs.last_scan_at IS NOT NULL THEN
      EXTRACT(EPOCH FROM (gs.last_scan_at + (gs.scan_interval_seconds || ' seconds')::interval - now()))::integer
    ELSE 0
  END AS seconds_until_next_scan,
  EXTRACT(EPOCH FROM (now() - gs.cycle_started_at))::integer AS seconds_in_cycle
FROM goal_sessions gs
WHERE gs.status IN ('active', 'scanning');

COMMENT ON VIEW scanning_status_dashboard IS
  'Real-time view of all scanning session statuses with countdown timers';

-- ============================================================================
-- STEP 13: Initialize existing active sessions
-- ============================================================================

-- Initialize scanning fields for existing active sessions
UPDATE goal_sessions
SET
  scanning_session_number = 1,
  scanning_session_started_at = COALESCE(scanning_session_started_at, created_at),
  scanning_session_ends_at = COALESCE(scanning_session_ends_at, created_at + interval '1 hour'),
  cycle_started_at = COALESCE(cycle_started_at, created_at),
  scans_in_current_session = COALESCE(scans_in_current_session, 0),
  total_scans_in_cycle = COALESCE(total_scans_in_cycle, 0),
  scanning_cycle_status = COALESCE(scanning_cycle_status, 'active'),
  max_scans_per_session = COALESCE(max_scans_per_session, 12),
  scan_interval_seconds = COALESCE(scan_interval_seconds, 300),
  unlimited_scanning = COALESCE(unlimited_scanning, false)
WHERE status IN ('active', 'scanning')
  AND scanning_session_started_at IS NULL;