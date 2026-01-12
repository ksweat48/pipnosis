/*
  # Add Fail-Safe for Orphaned Monitor States

  ## Purpose
  Prevents permanent scan deadlock when entry_monitor_state gets stuck in
  'ENTRY_MONITOR_ACTIVE' or 'EXECUTE_PENDING' with no active intent.

  ## Changes
  1. Create function to detect and auto-heal orphaned monitor states
  2. Function resets state to 'DISCOVERY_SCANNING' for orphaned sessions
  3. Logs all healing operations for audit trail
  4. Can be called manually or scheduled via cron

  ## Orphaned State Definition
  A monitor state is orphaned when:
  - State is 'ENTRY_MONITOR_ACTIVE' or 'EXECUTE_PENDING'
  - No active intent exists (status='monitoring')
  - State is older than 2 minutes

  ## Safety
  - Only resets states older than 2 minutes to avoid race conditions
  - Only affects sessions with no active monitoring intents
  - Returns count of healed sessions for monitoring
*/

-- Function to detect and heal orphaned monitor states
CREATE OR REPLACE FUNCTION heal_orphaned_monitor_states()
RETURNS TABLE (
  session_id uuid,
  old_state text,
  locked_symbol text,
  seconds_stuck bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Find and fix orphaned states
  RETURN QUERY
  WITH orphaned_sessions AS (
    SELECT
      ems.session_id,
      ems.state as old_state,
      ems.locked_symbol,
      EXTRACT(EPOCH FROM (NOW() - ems.monitor_started_at))::bigint as seconds_stuck
    FROM entry_monitor_state ems
    WHERE
      -- State indicates monitoring is active
      ems.state IN ('ENTRY_MONITOR_ACTIVE', 'EXECUTE_PENDING')
      -- But no active intent exists
      AND NOT EXISTS (
        SELECT 1
        FROM entry_intents ei
        WHERE ei.session_id = ems.session_id
          AND ei.status = 'monitoring'
      )
      -- State is stuck for more than 2 minutes (safety threshold)
      AND ems.monitor_started_at < NOW() - INTERVAL '2 minutes'
  ),
  healed AS (
    UPDATE entry_monitor_state
    SET
      state = 'DISCOVERY_SCANNING',
      locked_symbol = NULL,
      locked_direction = NULL,
      monitor_started_at = NULL,
      active_intent_id = NULL,
      updated_at = NOW()
    WHERE session_id IN (SELECT session_id FROM orphaned_sessions)
    RETURNING session_id
  )
  SELECT
    os.session_id,
    os.old_state,
    os.locked_symbol,
    os.seconds_stuck
  FROM orphaned_sessions os
  WHERE os.session_id IN (SELECT session_id FROM healed);

  -- Log healing operations
  RAISE NOTICE 'Healed % orphaned monitor states', (SELECT COUNT(*) FROM orphaned_sessions);
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION heal_orphaned_monitor_states IS
'Detects and automatically fixes orphaned entry monitor states that would otherwise block scanning permanently. Safe to run at any time.';

-- Grant execution to authenticated users and service role
GRANT EXECUTE ON FUNCTION heal_orphaned_monitor_states() TO authenticated, service_role;