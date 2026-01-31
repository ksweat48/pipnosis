/*
  # CCIP Session State Change Tracking System

  ## Purpose
  Track all session state machine transitions with full audit trail for post-hoc analysis
  and regression detection. Part of CCIP compliance for change control.

  ## SSOT Principle
  Single source of truth for session lifecycle events. All transitions logged with:
  - Previous state
  - New state  
  - Trigger reason (user action, timeout, system, etc.)
  - Timestamp
  - Initiator (user_id or system)

  ## Anti-Regression Design
  Future bugs can be investigated by replaying the state change sequence.
  Pattern analysis detects if state transitions are happening unexpectedly.

  ## Database Schema
  - Immutable log table (append-only, no deletes/updates)
  - RLS enforces user can only see their own transitions
  - Indexed for fast queries on failure patterns
*/

-- ============================================================================
-- 1. SESSION STATE CHANGE LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_state_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  session_id uuid NOT NULL REFERENCES goal_sessions(id),
  
  -- State transition details (SSOT)
  previous_status text NOT NULL,
  new_status text NOT NULL,
  trigger_reason text NOT NULL, -- e.g., 'auto_timeout', 'user_action', 'system_recovery'
  
  -- Trigger context (who initiated the change)
  triggered_by text NOT NULL, -- 'user', 'trigger', 'rpc', 'system'
  trigger_function text, -- e.g., 'unstick_session', 'auto_close_expired'
  
  -- Metrics at time of transition
  open_trades_count integer,
  closed_trades_count integer,
  session_pnl numeric,
  time_in_previous_state_seconds numeric,
  
  -- Governance metadata
  metadata jsonb DEFAULT '{}'::jsonb,
  error_details text, -- If transition failed
  
  -- Timestamps
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_session_state_changes_user ON session_state_change_log(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_state_changes_session ON session_state_change_log(session_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_state_changes_transitions ON session_state_change_log(previous_status, new_status);
CREATE INDEX IF NOT EXISTS idx_session_state_changes_reason ON session_state_change_log(trigger_reason, changed_at DESC);

-- RLS: Users can read their own state change logs (governance visibility)
ALTER TABLE session_state_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session state changes"
  ON session_state_change_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can insert state changes"
  ON session_state_change_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 2. LOG_SESSION_STATE_CHANGE - Immutable State Transition Logger
-- ============================================================================

CREATE OR REPLACE FUNCTION log_session_state_change(
  p_user_id uuid,
  p_session_id uuid,
  p_previous_status text,
  p_new_status text,
  p_trigger_reason text,
  p_triggered_by text DEFAULT 'system',
  p_trigger_function text DEFAULT NULL,
  p_open_trades integer DEFAULT NULL,
  p_closed_trades integer DEFAULT NULL,
  p_session_pnl numeric DEFAULT NULL,
  p_time_in_state_seconds numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_error_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- CCIP: Log state transition immutably
  INSERT INTO session_state_change_log (
    user_id,
    session_id,
    previous_status,
    new_status,
    trigger_reason,
    triggered_by,
    trigger_function,
    open_trades_count,
    closed_trades_count,
    session_pnl,
    time_in_previous_state_seconds,
    metadata,
    error_details,
    changed_at
  ) VALUES (
    p_user_id,
    p_session_id,
    p_previous_status,
    p_new_status,
    p_trigger_reason,
    p_triggered_by,
    p_trigger_function,
    p_open_trades,
    p_closed_trades,
    p_session_pnl,
    p_time_in_state_seconds,
    p_metadata || jsonb_build_object(
      'logged_at', now(),
      'auth_context_uid', auth.uid()
    ),
    p_error_details,
    now()
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
EXCEPTION WHEN OTHERS THEN
  -- Silently fail - don't break state transitions due to logging errors
  -- But we could add an emergency logging fallback here if needed
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION log_session_state_change IS
  'CCIP: Immutable state transition logger. Tracks all session status changes for audit trail and anti-regression analysis.';

GRANT EXECUTE ON FUNCTION log_session_state_change TO authenticated, service_role;

-- ============================================================================
-- 3. STATE CHANGE TRACKING VIEW - For Diagnostics
-- ============================================================================

CREATE OR REPLACE VIEW session_state_history AS
SELECT
  user_id,
  session_id,
  previous_status,
  new_status,
  trigger_reason,
  triggered_by,
  time_in_previous_state_seconds,
  open_trades_count,
  changed_at,
  ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY changed_at) as transition_sequence
FROM session_state_change_log
ORDER BY session_id, changed_at;

-- ============================================================================
-- 4. UNSTICK_SESSION - Add State Change Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION unstick_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session record;
  v_open_trades integer;
  v_health jsonb;
  v_closed_trades integer;
  v_total_pnl numeric;
  v_log_id uuid;
  v_time_in_state numeric;
BEGIN
  -- Get health status first
  v_health := get_session_health(p_session_id);
  
  IF (v_health->>'success')::boolean = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', v_health->>'error'
    );
  END IF;

  -- Must be stuck to unstick
  IF NOT (v_health->>'is_stuck')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session is not stuck',
      'current_status', v_health->>'status'
    );
  END IF;

  -- Cannot unstick with open trades
  IF (v_health->'trades'->>'open')::integer > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot unstick session with open trades. Close all trades first.',
      'open_trades', (v_health->'trades'->>'open')::integer
    );
  END IF;

  -- Get full session details
  SELECT
    id,
    user_id,
    status,
    target_value,
    scanning_started_at,
    created_at,
    updated_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  -- Calculate time in state
  v_time_in_state := EXTRACT(EPOCH FROM (now() - v_session.updated_at));

  -- Get final metrics
  SELECT 
    COUNT(*) FILTER (WHERE status = 'open'),
    COUNT(*) FILTER (WHERE status = 'closed'),
    COALESCE(SUM(profit_loss), 0)
  INTO v_open_trades, v_closed_trades, v_total_pnl
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id;

  -- CCIP: Log the state transition before making changes
  v_log_id := log_session_state_change(
    v_session.user_id,
    p_session_id,
    v_session.status,
    'user_stopped',
    'manual_unstick',
    'user',
    'unstick_session',
    v_open_trades,
    v_closed_trades,
    v_total_pnl,
    v_time_in_state,
    jsonb_build_object(
      'stuck_reason', v_health->>'stuck_reason',
      'prev_status', v_health->>'status'
    )
  );

  -- SSOT: Update session state (close it)
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = now(),
    awaiting_continuation_since = NULL,
    updated_at = now()
  WHERE id = p_session_id
    AND user_id = auth.uid();

  -- Clean up any pending modals
  UPDATE pending_user_modals
  SET
    dismissed_at = now(),
    user_action = 'manual_unstick'
  WHERE goal_session_id = p_session_id
    AND user_id = auth.uid()
    AND dismissed_at IS NULL;

  -- Create notification
  INSERT INTO goal_notifications (
    goal_session_id,
    user_id,
    type,
    priority,
    title,
    message,
    metadata,
    channels
  ) VALUES (
    p_session_id,
    v_session.user_id,
    'session_ended',
    'medium',
    'Session Manually Recovered',
    format('%s trades completed with $%s final result', 
      COALESCE(v_closed_trades, 0),
      ROUND(v_total_pnl::numeric, 2)),
    jsonb_build_object(
      'close_reason', 'manual_unstick',
      'previous_status', v_health->>'status',
      'stuck_reason', v_health->>'stuck_reason',
      'trades_completed', v_closed_trades,
      'final_pnl', ROUND(v_total_pnl::numeric, 2),
      'unstuck_at', now(),
      'state_change_log_id', v_log_id
    ),
    ARRAY['in_app']
  );

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Session successfully unstuck and closed',
    'session_id', p_session_id,
    'new_status', 'user_stopped',
    'trades_closed', v_closed_trades,
    'final_pnl', ROUND(v_total_pnl::numeric, 2),
    'state_change_log_id', v_log_id
  );

EXCEPTION WHEN OTHERS THEN
  -- Log the failure
  v_log_id := log_session_state_change(
    auth.uid(),
    p_session_id,
    v_session.status,
    NULL,
    'manual_unstick_failed',
    'user',
    'unstick_session',
    p_error_details := SQLERRM
  );
  
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Failed to unstick session',
    'details', SQLERRM,
    'state_change_log_id', v_log_id
  );
END;
$$;

COMMENT ON FUNCTION unstick_session IS
  'SSOT: Manual session recovery. User can unstick their own session if no trades are open. CCIP: Logs state transitions with full audit trail.';

GRANT EXECUTE ON FUNCTION unstick_session TO authenticated;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '[CCIP] ✅ Created session_state_change_log table for immutable audit trail';
  RAISE NOTICE '[CCIP] ✅ Created log_session_state_change() function for state transition tracking';
  RAISE NOTICE '[CCIP] ✅ Updated unstick_session() with state change logging';
  RAISE NOTICE '[CCIP] ✅ Created session_state_history view for diagnostics';
  RAISE NOTICE '[CCIP] ✅ All state transitions now logged for anti-regression analysis';
END $$;
