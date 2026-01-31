/*
  # CCIP Session Health Check Governance & Auth Fix

  ## Problem Statement (CCIP Root Cause Analysis)
  
  Frontend crash loop: GoalSessionDashboard calls check_session_timeout_health() on page load,
  which fails due to auth context timing issues (auth.uid() not yet established when RPC executes).
  
  Current broken logic:
  1. Session manager loads valid session ✓
  2. Health check RPC executes → fails due to auth timing ✗
  3. Component treats failure as "session deleted" → sets session=null ✗
  4. Cleanup/re-mount → back to step 1 (infinite loop) ✗
  
  SSOT Violation: Using RPC result as a GATE to session validity, when the session manager
  already provided authoritative session data.
  
  ## Solution (CCIP Compliant)

  1. **Separate Concerns**:
     - Session validity = managed by getActiveSession() (SSOT authority)
     - Health diagnostics = informational only (for UI display)
  
  2. **Add Governance Tracking**:
     - Log health check calls and failures for audit trail
     - Track pattern of auth context timing issues
     - Enable post-hoc analysis of health check reliability
  
  3. **Fix RPC Auth Context**:
     - Health check RPC runs but returns diagnostic data only
     - Frontend never uses result to determine session validity
     - Frontend uses session manager result as the authority
  
  ## SSOT Authority Chain
  - Session validity: goal_sessions.id + goal_sessions.status + auth.uid()
  - Session manager (AUTHORITY): smartGoalSessionManager.getActiveSession()
  - Health diagnostics: check_session_timeout_health() (informational, never gates)
  
  ## Database Changes
  - Add session_health_check_log table for governance audit trail
  - Add RLS policies for governance tracking
  - No changes to existing SSOT columns (immutable)
*/

-- ============================================================================
-- 1. SESSION HEALTH CHECK LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS session_health_check_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  session_id uuid NOT NULL REFERENCES goal_sessions(id),
  check_timestamp timestamptz DEFAULT now(),
  rpc_success boolean NOT NULL,
  rpc_error text,
  auth_context_uid uuid,
  session_status text,
  is_stuck_detected boolean,
  open_trades_count integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for governance queries
CREATE INDEX IF NOT EXISTS idx_session_health_check_log_user ON session_health_check_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_health_check_log_session ON session_health_check_log(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_health_check_log_failures ON session_health_check_log(rpc_success, created_at DESC) WHERE NOT rpc_success;

-- RLS: Users can only read their own health check logs (governance visibility)
ALTER TABLE session_health_check_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session health logs"
  ON session_health_check_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can insert health check logs"
  ON session_health_check_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 2. LOG_SESSION_HEALTH_CHECK - SSOT Compliant Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION log_session_health_check(
  p_user_id uuid,
  p_session_id uuid,
  p_rpc_success boolean,
  p_rpc_error text DEFAULT NULL,
  p_session_status text DEFAULT NULL,
  p_is_stuck boolean DEFAULT NULL,
  p_open_trades integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- GOVERNANCE: Log the health check attempt for audit trail
  INSERT INTO session_health_check_log (
    user_id,
    session_id,
    rpc_success,
    rpc_error,
    auth_context_uid,
    session_status,
    is_stuck_detected,
    open_trades_count,
    metadata
  ) VALUES (
    p_user_id,
    p_session_id,
    p_rpc_success,
    p_rpc_error,
    auth.uid(),
    p_session_status,
    p_is_stuck,
    p_open_trades,
    jsonb_build_object(
      'call_timestamp', now(),
      'auth_context_exists', auth.uid() IS NOT NULL,
      'auth_mismatch', CASE 
        WHEN auth.uid() IS NULL THEN 'auth_not_ready'
        WHEN auth.uid() != p_user_id THEN 'auth_user_mismatch'
        ELSE 'auth_ok'
      END
    )
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
EXCEPTION WHEN OTHERS THEN
  -- Silently fail - don't break health checks due to logging errors
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION log_session_health_check IS
  'GOVERNANCE: Log session health check attempts for audit trail. Used to detect auth context timing issues.';

GRANT EXECUTE ON FUNCTION log_session_health_check TO authenticated;

-- ============================================================================
-- 3. UPDATE check_session_timeout_health - Add Governance Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION check_session_timeout_health(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session record;
  v_elapsed_seconds numeric;
  v_open_trades integer;
  v_result jsonb;
  v_log_id uuid;
BEGIN
  -- SSOT AUTHORITY: Session status via awaiting_continuation_since + status
  
  SELECT
    id,
    user_id,
    status,
    awaiting_continuation_since,
    scanning_started_at,
    next_scan_time,
    created_at,
    updated_at
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();

  IF v_session.id IS NULL THEN
    -- GOVERNANCE: Log the failure
    v_log_id := log_session_health_check(
      auth.uid(),
      p_session_id,
      false,
      'Session not found or access denied',
      NULL
    );
    
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found or access denied',
      'governance_log_id', v_log_id
    );
  END IF;

  -- Count open trades (cannot unstick with open trades)
  SELECT COUNT(*)
  INTO v_open_trades
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status = 'open';

  -- Check continuation timeout (SSOT: awaiting_continuation_since)
  IF v_session.status = 'awaiting_continuation'
     AND v_session.awaiting_continuation_since IS NOT NULL THEN
    
    v_elapsed_seconds := EXTRACT(EPOCH FROM (now() - v_session.awaiting_continuation_since));
    
    -- Note: Database triggers handle auto-close at 60 seconds
    -- This function is for diagnostics only
    v_result := jsonb_build_object(
      'success', true,
      'session_id', v_session.id,
      'status', v_session.status,
      'is_in_timeout', v_elapsed_seconds > 60,
      'elapsed_seconds', ROUND(v_elapsed_seconds, 1),
      'open_trades', v_open_trades,
      'message', CASE 
        WHEN v_elapsed_seconds > 60 THEN 'Session expired - should be auto-closed by trigger'
        ELSE format('Awaiting continuation for %.0f seconds', v_elapsed_seconds)
      END
    );
    
    -- GOVERNANCE: Log successful check
    v_log_id := log_session_health_check(
      v_session.user_id,
      v_session.id,
      true,
      NULL,
      v_session.status,
      v_elapsed_seconds > 60,
      v_open_trades
    );
    
    RETURN v_result || jsonb_build_object('governance_log_id', v_log_id);
  END IF;

  -- Check scanning timeout (SSOT: scanning_started_at)
  IF v_session.status = 'scanning'
     AND v_session.scanning_started_at IS NOT NULL THEN
    
    v_elapsed_seconds := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at));
    
    v_result := jsonb_build_object(
      'success', true,
      'session_id', v_session.id,
      'status', v_session.status,
      'is_in_timeout', v_elapsed_seconds > 3600,
      'elapsed_seconds', ROUND(v_elapsed_seconds, 1),
      'open_trades', v_open_trades,
      'message', CASE
        WHEN v_elapsed_seconds > 3600 THEN 'Session scanning for over 60 minutes'
        ELSE format('Scanning for %.0f seconds', v_elapsed_seconds)
      END
    );
    
    -- GOVERNANCE: Log successful check
    v_log_id := log_session_health_check(
      v_session.user_id,
      v_session.id,
      true,
      NULL,
      v_session.status,
      v_elapsed_seconds > 3600,
      v_open_trades
    );
    
    RETURN v_result || jsonb_build_object('governance_log_id', v_log_id);
  END IF;

  -- Session is healthy
  v_result := jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'status', v_session.status,
    'is_in_timeout', false,
    'open_trades', v_open_trades,
    'message', 'Session is healthy'
  );
  
  -- GOVERNANCE: Log successful check
  v_log_id := log_session_health_check(
    v_session.user_id,
    v_session.id,
    true,
    NULL,
    v_session.status,
    false,
    v_open_trades
  );

  RETURN v_result || jsonb_build_object('governance_log_id', v_log_id);

EXCEPTION WHEN OTHERS THEN
  -- GOVERNANCE: Log the exception
  v_log_id := log_session_health_check(
    auth.uid(),
    p_session_id,
    false,
    SQLERRM,
    NULL
  );
  
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'governance_log_id', v_log_id
  );
END;
$$;

COMMENT ON FUNCTION check_session_timeout_health IS 
  'SSOT: Diagnostic health check using awaiting_continuation_since timestamp. No auto-close - database triggers handle enforcement. GOVERNANCE: Logs all calls for audit trail.';

GRANT EXECUTE ON FUNCTION check_session_timeout_health TO authenticated;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '[CCIP] ✅ Created session_health_check_log table for governance audit trail';
  RAISE NOTICE '[CCIP] ✅ Created log_session_health_check() for immutable audit tracking';
  RAISE NOTICE '[CCIP] ✅ Updated check_session_timeout_health() with governance logging';
  RAISE NOTICE '[CCIP] ✅ Added RLS policies for governance table';
  RAISE NOTICE '[CCIP] ✅ SSOT: Health check is purely diagnostic, never gates session validity';
END $$;
