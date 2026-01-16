/*
  # Fix Scanning Duration Mismatch (15min → 60min) - Final

  Problem: Database expects 15min, code expects 60min → stuck sessions
  Solution: Align database to 60min, unstuck sessions immediately
*/

-- Update default to 60 minutes
ALTER TABLE goal_sessions
ALTER COLUMN scanning_duration_minutes SET DEFAULT 60;

-- Update existing sessions
UPDATE goal_sessions
SET scanning_duration_minutes = 60
WHERE scanning_duration_minutes = 15;

-- Unstick sessions at 15m by triggering modal immediately
UPDATE goal_sessions
SET
  status = 'awaiting_continuation',
  awaiting_continuation_confirmation = true,
  continuation_confirmation_expires_at = now() + interval '1 minute'
WHERE status IN ('scanning', 'trade_pending')
  AND scanning_started_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 >= 15
  AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 < 80
  AND (awaiting_continuation_confirmation IS NULL OR awaiting_continuation_confirmation = false);

-- Force close sessions stuck >80 minutes (safety net)
UPDATE goal_sessions
SET
  status = 'user_stopped',
  completed_at = now(),
  awaiting_continuation_confirmation = false,
  continuation_confirmation_expires_at = NULL
WHERE status IN ('scanning', 'trade_pending')
  AND scanning_started_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 >= 80;

-- Drop and recreate cleanup function
DROP FUNCTION IF EXISTS cleanup_stuck_scanning_sessions();

CREATE FUNCTION cleanup_stuck_scanning_sessions()
RETURNS TABLE (
  fixed_sessions integer,
  force_closed_sessions integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fixed integer := 0;
  v_force_closed integer := 0;
  v_temp integer := 0;
BEGIN
  -- Trigger modal for sessions at 60+ minutes
  UPDATE goal_sessions
  SET
    status = 'awaiting_continuation',
    awaiting_continuation_confirmation = true,
    continuation_confirmation_expires_at = now() + interval '1 minute'
  WHERE status IN ('scanning', 'trade_pending')
    AND scanning_started_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 >= 60
    AND (awaiting_continuation_confirmation IS NULL OR awaiting_continuation_confirmation = false);

  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  -- Force close sessions at 80+ minutes
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL
  WHERE status IN ('scanning', 'trade_pending', 'awaiting_continuation')
    AND scanning_started_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 >= 80;

  GET DIAGNOSTICS v_force_closed = ROW_COUNT;

  -- Force close expired modals
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = now(),
    awaiting_continuation_confirmation = false,
    continuation_confirmation_expires_at = NULL
  WHERE status = 'awaiting_continuation'
    AND continuation_confirmation_expires_at < now() - interval '1 minute';

  GET DIAGNOSTICS v_temp = ROW_COUNT;
  v_force_closed := v_force_closed + v_temp;

  RETURN QUERY SELECT v_fixed, v_force_closed;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_stuck_scanning_sessions TO authenticated, service_role;
