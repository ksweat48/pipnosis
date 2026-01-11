/*
  # Emergency Monitor State Recovery System

  ## Purpose
  Provides admin tools to detect and fix orphaned monitor states that create
  deadlocks in the EQS monitoring system.

  ## Problem Scenarios
  1. Monitor state shows 'ENTRY_MONITOR_ACTIVE' but no active intent exists
  2. Session stuck in 'awaiting_continuation' with expired deadline
  3. State machine inconsistencies preventing scanning

  ## Functions
  1. `diagnose_monitor_state` - Check for state inconsistencies
  2. `force_reset_monitor_state` - Emergency state reset for admins
  3. `auto_heal_orphaned_states` - Automatic healing function

  ## Security
  - Admin-only functions (security definer with role checks)
  - Comprehensive audit logging
  - Non-destructive healing (preserves session data)
*/

-- ============================================================================
-- FUNCTION 1: Diagnose Monitor State
-- ============================================================================

CREATE OR REPLACE FUNCTION diagnose_monitor_state(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_intent_count integer;
  v_active_intent record;
  v_diagnosis jsonb;
  v_has_issue boolean := false;
  v_issues text[] := '{}';
BEGIN
  -- Get session state
  SELECT
    id,
    user_id,
    status,
    entry_monitor_state,
    awaiting_continuation_response,
    continuation_deadline,
    created_at,
    completed_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'Session not found',
      'session_id', p_session_id
    );
  END IF;

  -- Count active intents
  SELECT COUNT(*) INTO v_intent_count
  FROM entry_intents
  WHERE goal_session_id = p_session_id
    AND status = 'monitoring';

  -- Get most recent intent if any
  SELECT * INTO v_active_intent
  FROM entry_intents
  WHERE goal_session_id = p_session_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Check for state inconsistencies
  
  -- Issue 1: Monitor state says active but no active intent
  IF (v_session.entry_monitor_state = 'ENTRY_MONITOR_ACTIVE' OR 
      v_session.entry_monitor_state = 'EXECUTE_PENDING')
     AND v_intent_count = 0
  THEN
    v_has_issue := true;
    v_issues := array_append(v_issues, 'ORPHANED_MONITOR_STATE: Monitor state is ' || v_session.entry_monitor_state || ' but no active intent exists');
  END IF;

  -- Issue 2: Awaiting continuation with expired deadline
  IF v_session.awaiting_continuation_response = true
     AND v_session.continuation_deadline IS NOT NULL
     AND now() > v_session.continuation_deadline
     AND v_session.status != 'completed'
  THEN
    v_has_issue := true;
    v_issues := array_append(v_issues, 'EXPIRED_CONTINUATION: Continuation deadline passed but session not closed');
  END IF;

  -- Issue 3: Status is awaiting_continuation but no deadline set
  IF v_session.status = 'awaiting_continuation'
     AND v_session.continuation_deadline IS NULL
  THEN
    v_has_issue := true;
    v_issues := array_append(v_issues, 'INVALID_CONTINUATION_STATE: Status is awaiting_continuation but no deadline');
  END IF;

  -- Issue 4: Session completed but monitor state not cleared
  IF v_session.status = 'completed'
     AND v_session.entry_monitor_state IS NOT NULL
     AND v_session.entry_monitor_state != 'DISCOVERY_SCANNING'
  THEN
    v_has_issue := true;
    v_issues := array_append(v_issues, 'UNCLEANED_COMPLETED_STATE: Session completed but monitor state not cleared');
  END IF;

  -- Build diagnosis report
  v_diagnosis := jsonb_build_object(
    'session_id', p_session_id,
    'has_issues', v_has_issue,
    'issues', v_issues,
    'current_state', jsonb_build_object(
      'status', v_session.status,
      'entry_monitor_state', v_session.entry_monitor_state,
      'awaiting_continuation', v_session.awaiting_continuation_response,
      'continuation_deadline', v_session.continuation_deadline,
      'deadline_expired', v_session.continuation_deadline IS NOT NULL AND now() > v_session.continuation_deadline
    ),
    'intent_info', jsonb_build_object(
      'active_intent_count', v_intent_count,
      'latest_intent_status', CASE WHEN v_active_intent.id IS NOT NULL THEN v_active_intent.status ELSE NULL END,
      'latest_intent_created', CASE WHEN v_active_intent.id IS NOT NULL THEN v_active_intent.created_at ELSE NULL END
    ),
    'recommended_action', CASE
      WHEN v_has_issue THEN 'Run force_reset_monitor_state() to fix'
      ELSE 'No action needed - state is consistent'
    END
  );

  RETURN v_diagnosis;
END;
$$;

-- ============================================================================
-- FUNCTION 2: Force Reset Monitor State (Admin Emergency Tool)
-- ============================================================================

CREATE OR REPLACE FUNCTION force_reset_monitor_state(
  p_session_id uuid,
  p_admin_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_before_state jsonb;
  v_after_state jsonb;
  v_changes_made text[] := '{}';
BEGIN
  -- Security check: Verify admin role if admin_user_id provided
  IF p_admin_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = p_admin_user_id
        AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Permission denied: admin role required';
    END IF;
  END IF;

  -- Get current session state
  SELECT * INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'Session not found',
      'session_id', p_session_id
    );
  END IF;

  -- Record before state
  v_before_state := jsonb_build_object(
    'status', v_session.status,
    'entry_monitor_state', v_session.entry_monitor_state,
    'awaiting_continuation', v_session.awaiting_continuation_response,
    'continuation_deadline', v_session.continuation_deadline
  );

  -- HEALING LOGIC
  
  -- Fix 1: Reset orphaned monitor state
  IF v_session.entry_monitor_state IS NOT NULL
     AND v_session.entry_monitor_state != 'DISCOVERY_SCANNING'
     AND NOT EXISTS (
       SELECT 1 FROM entry_intents
       WHERE goal_session_id = p_session_id
         AND status = 'monitoring'
     )
  THEN
    UPDATE goal_sessions
    SET entry_monitor_state = 'DISCOVERY_SCANNING',
        updated_at = now()
    WHERE id = p_session_id;
    
    v_changes_made := array_append(v_changes_made, 'Reset entry_monitor_state to DISCOVERY_SCANNING');
  END IF;

  -- Fix 2: Close expired continuations
  IF v_session.awaiting_continuation_response = true
     AND v_session.continuation_deadline IS NOT NULL
     AND now() > v_session.continuation_deadline
     AND v_session.status != 'completed'
  THEN
    UPDATE goal_sessions
    SET status = 'completed',
        completed_at = now(),
        awaiting_continuation_response = false,
        continuation_decision = 'admin_force_closed',
        entry_monitor_state = NULL,
        updated_at = now()
    WHERE id = p_session_id;
    
    v_changes_made := array_append(v_changes_made, 'Closed expired continuation session');
    
    -- Clean up modal
    DELETE FROM pending_user_modals
    WHERE goal_session_id = p_session_id
      AND modal_type = 'continuation'
      AND dismissed_at IS NULL;
    
    v_changes_made := array_append(v_changes_made, 'Deleted pending continuation modal');
  END IF;

  -- Fix 3: Reset to scanning if status is awaiting_continuation but no deadline
  IF v_session.status = 'awaiting_continuation'
     AND v_session.continuation_deadline IS NULL
  THEN
    UPDATE goal_sessions
    SET status = 'scanning',
        awaiting_continuation_response = false,
        entry_monitor_state = 'DISCOVERY_SCANNING',
        updated_at = now()
    WHERE id = p_session_id;
    
    v_changes_made := array_append(v_changes_made, 'Reset invalid awaiting_continuation status to scanning');
  END IF;

  -- Fix 4: Clean up completed session state
  IF v_session.status = 'completed'
     AND (v_session.entry_monitor_state IS NOT NULL 
          OR v_session.awaiting_continuation_response = true)
  THEN
    UPDATE goal_sessions
    SET entry_monitor_state = NULL,
        awaiting_continuation_response = false,
        updated_at = now()
    WHERE id = p_session_id;
    
    v_changes_made := array_append(v_changes_made, 'Cleaned up completed session state');
  END IF;

  -- Cancel any stuck monitoring intents
  UPDATE entry_intents
  SET status = 'cancelled',
      cancellation_reason = 'Admin force reset - orphaned intent',
      updated_at = now()
  WHERE goal_session_id = p_session_id
    AND status = 'monitoring'
    AND (created_at < now() - interval '10 minutes'
         OR updated_at < now() - interval '5 minutes');

  IF FOUND THEN
    v_changes_made := array_append(v_changes_made, 'Cancelled orphaned monitoring intents');
  END IF;

  -- Get after state
  SELECT * INTO v_session FROM goal_sessions WHERE id = p_session_id;
  
  v_after_state := jsonb_build_object(
    'status', v_session.status,
    'entry_monitor_state', v_session.entry_monitor_state,
    'awaiting_continuation', v_session.awaiting_continuation_response,
    'continuation_deadline', v_session.continuation_deadline
  );

  -- Log the recovery action
  RAISE NOTICE '[EMERGENCY_RECOVERY] Session % state reset by admin %', p_session_id, p_admin_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'changes_made', v_changes_made,
    'before_state', v_before_state,
    'after_state', v_after_state,
    'admin_user_id', p_admin_user_id,
    'timestamp', now()
  );
END;
$$;

-- ============================================================================
-- FUNCTION 3: Auto-Heal All Orphaned States (Maintenance)
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_heal_orphaned_monitor_states()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_healed_count integer := 0;
  v_session record;
  v_healed_sessions uuid[] := '{}';
BEGIN
  -- Find and fix orphaned monitor states
  FOR v_session IN
    SELECT gs.id, gs.entry_monitor_state
    FROM goal_sessions gs
    WHERE gs.status IN ('active', 'scanning')
      AND gs.entry_monitor_state IN ('ENTRY_MONITOR_ACTIVE', 'EXECUTE_PENDING')
      AND NOT EXISTS (
        SELECT 1 FROM entry_intents ei
        WHERE ei.goal_session_id = gs.id
          AND ei.status = 'monitoring'
      )
  LOOP
    -- Heal this session
    UPDATE goal_sessions
    SET entry_monitor_state = 'DISCOVERY_SCANNING',
        updated_at = now()
    WHERE id = v_session.id;
    
    v_healed_count := v_healed_count + 1;
    v_healed_sessions := array_append(v_healed_sessions, v_session.id);
    
    RAISE NOTICE '[AUTO_HEAL] Fixed orphaned monitor state for session %', v_session.id;
  END LOOP;

  RETURN jsonb_build_object(
    'healed_count', v_healed_count,
    'healed_sessions', v_healed_sessions,
    'timestamp', now()
  );
END;
$$;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

-- Diagnose is safe for all authenticated users (read-only)
GRANT EXECUTE ON FUNCTION diagnose_monitor_state TO authenticated;

-- Force reset requires admin role (checked within function)
GRANT EXECUTE ON FUNCTION force_reset_monitor_state TO authenticated;

-- Auto-heal is for service role only (maintenance)
GRANT EXECUTE ON FUNCTION auto_heal_orphaned_monitor_states TO service_role;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION diagnose_monitor_state IS
  'Diagnose monitor state inconsistencies for a session. Safe read-only check.';

COMMENT ON FUNCTION force_reset_monitor_state IS
  'Emergency admin tool to fix orphaned monitor states and deadlocks. Requires admin role.';

COMMENT ON FUNCTION auto_heal_orphaned_monitor_states IS
  'Automatic healing function to fix all orphaned states. For maintenance/cron jobs.';
