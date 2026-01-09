/*
  # Sync Legacy Status Field with Entry Monitor State

  ## Problem
  The system has TWO separate status tracking fields:
  - `status` (legacy field) - Checked by UnifiedEntryMonitor
  - `entry_monitor_state` (new field) - Updated by EntryMonitorCoordinator

  When they're out of sync, the monitor rejects valid sessions as "SESSION_INACTIVE"
  causing immediate abandonment and system deadlock.

  ## Solution
  Update `transition_entry_monitor_state` function to sync both fields atomically.
  This ensures the legacy `status` field always reflects the current monitor state.

  ## Status Mapping
  - DISCOVERY_SCANNING → 'scanning'
  - ENTRY_MONITOR_ACTIVE → 'active' (waiting for entry)
  - TRADE_ACTIVE → 'in_trade'
  - ABANDONED_RESCAN_REQUESTED → 'scanning' (return to discovery)
  - EXECUTE_PENDING → 'trade_pending'
  - ENTRY_INTENT_CREATED → 'active' (preparing to monitor)

  ## Security
  - Function remains SECURITY DEFINER
  - No RLS changes needed
*/

-- Update transition function to sync both status fields
CREATE OR REPLACE FUNCTION transition_entry_monitor_state(
  p_session_id uuid,
  p_new_state text,
  p_locked_symbol text DEFAULT NULL,
  p_locked_direction text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_old_state text;
  v_old_status text;
BEGIN
  -- Get current state for logging
  SELECT entry_monitor_state, status
  INTO v_old_state, v_old_status
  FROM goal_sessions
  WHERE id = p_session_id;

  -- Update both entry_monitor_state AND status fields atomically
  UPDATE goal_sessions
  SET
    entry_monitor_state = p_new_state,
    -- NEW: Sync legacy status field with monitor state
    status = CASE
      WHEN p_new_state = 'DISCOVERY_SCANNING' THEN 'scanning'
      WHEN p_new_state = 'ENTRY_INTENT_CREATED' THEN 'active'
      WHEN p_new_state = 'ENTRY_MONITOR_ACTIVE' THEN 'active'
      WHEN p_new_state = 'EXECUTE_PENDING' THEN 'trade_pending'
      WHEN p_new_state = 'TRADE_ACTIVE' THEN 'in_trade'
      WHEN p_new_state = 'ABANDONED_RESCAN_REQUESTED' THEN 'scanning'
      ELSE status -- Preserve status for any unknown states
    END,
    locked_symbol = COALESCE(p_locked_symbol,
      CASE WHEN p_new_state = 'DISCOVERY_SCANNING' THEN NULL ELSE locked_symbol END),
    locked_direction = COALESCE(p_locked_direction,
      CASE WHEN p_new_state = 'DISCOVERY_SCANNING' THEN NULL ELSE locked_direction END),
    entry_monitor_started_at = CASE
      WHEN p_new_state = 'ENTRY_MONITOR_ACTIVE' THEN now()
      WHEN p_new_state = 'DISCOVERY_SCANNING' THEN NULL
      ELSE entry_monitor_started_at
    END,
    updated_at = now()
  WHERE id = p_session_id;

  RAISE NOTICE '[STATE_SYNC] Session % transitioned from %/% to %/% (symbol: %, direction: %)',
    p_session_id, v_old_state, v_old_status, p_new_state,
    CASE
      WHEN p_new_state = 'DISCOVERY_SCANNING' THEN 'scanning'
      WHEN p_new_state = 'ENTRY_INTENT_CREATED' THEN 'active'
      WHEN p_new_state = 'ENTRY_MONITOR_ACTIVE' THEN 'active'
      WHEN p_new_state = 'EXECUTE_PENDING' THEN 'trade_pending'
      WHEN p_new_state = 'TRADE_ACTIVE' THEN 'in_trade'
      WHEN p_new_state = 'ABANDONED_RESCAN_REQUESTED' THEN 'scanning'
      ELSE v_old_status
    END,
    p_locked_symbol, p_locked_direction;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions (refresh in case of any issues)
GRANT EXECUTE ON FUNCTION transition_entry_monitor_state TO authenticated;

-- Add comment for future maintainers
COMMENT ON FUNCTION transition_entry_monitor_state IS
'Transitions entry monitor state and synchronizes legacy status field.
CRITICAL: Both fields MUST stay in sync to prevent monitor rejection.
See: unified-entry-monitor.ts line 284';
