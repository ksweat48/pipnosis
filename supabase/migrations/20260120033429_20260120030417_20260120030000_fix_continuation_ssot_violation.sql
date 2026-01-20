/*
  # Fix Continuation SSOT Trigger - Add Open Trades Safety Check

  ## Critical Safety Gap
  The enforce_continuation_timeout_ssot() trigger closes sessions after 60 seconds
  in 'awaiting_continuation' status WITHOUT checking for open trades.
  
  This violates the core safety rule:
  **NEVER close a session with open trades - prevents orphaned positions**

  ## Root Cause
  The SSOT consolidation (20260120030000) correctly eliminated duplicate columns
  but missed migrating the open trades safety check from the old functions.

  ## Fix
  Add defense-in-depth check to enforce_continuation_timeout_ssot():
  1. Check for ANY open trades before auto-closing
  2. If open trades exist, clear awaiting_continuation but keep session active
  3. Log warning if this edge case is hit

  ## CCIP Compliance
  - ✅ Correctness: Never orphans trades
  - ✅ Completeness: Covers all timeout paths
  - ✅ Immutability: Trigger enforces at database layer
  - ✅ Provenance: Clear audit trail in logs
  - ✅ Degradation: Graceful - session stays active with open trades

  ## Safety
  - Non-breaking: Only adds safety check
  - Defense-in-depth: Normal flow already prevents this, but trigger adds failsafe
  - Fail-safe: If edge case hit, keeps session active instead of orphaning trade
*/

-- ============================================================================
-- STEP 1: Verify Current State
-- ============================================================================

DO $$
DECLARE
  v_sessions_with_open_trades integer;
BEGIN
  -- Check if any sessions in awaiting_continuation have open trades
  SELECT COUNT(*) INTO v_sessions_with_open_trades
  FROM goal_sessions gs
  WHERE gs.status = 'awaiting_continuation'
    AND EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = gs.id
        AND gst.status = 'open'
    );
  
  IF v_sessions_with_open_trades > 0 THEN
    RAISE WARNING '[Safety Check] Found % sessions in awaiting_continuation WITH open trades - they would have been orphaned!', 
      v_sessions_with_open_trades;
  ELSE
    RAISE NOTICE '[Safety Check] ✅ No sessions in awaiting_continuation with open trades';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Fix SSOT Trigger to Include Open Trades Check
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_continuation_timeout_ssot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_open_trades boolean;
BEGIN
  -- When entering awaiting_continuation status, set the timestamp
  IF NEW.status = 'awaiting_continuation' AND OLD.status != 'awaiting_continuation' THEN
    NEW.awaiting_continuation_since := now();
    RAISE NOTICE '[Continuation SSOT] Session % entered awaiting_continuation', NEW.id;
  END IF;
  
  -- When leaving awaiting_continuation status, clear the timestamp
  IF NEW.status != 'awaiting_continuation' AND OLD.status = 'awaiting_continuation' THEN
    NEW.awaiting_continuation_since := NULL;
    RAISE NOTICE '[Continuation SSOT] Session % left awaiting_continuation', NEW.id;
  END IF;
  
  -- Auto-close if timeout exceeded (60 seconds)
  IF NEW.status = 'awaiting_continuation' 
     AND NEW.awaiting_continuation_since IS NOT NULL
     AND now() > NEW.awaiting_continuation_since + interval '60 seconds'
  THEN
    -- CRITICAL SAFETY CHECK: Never auto-close if there are open trades
    -- This is defense-in-depth - normal flow prevents this, but trigger adds failsafe
    SELECT EXISTS (
      SELECT 1
      FROM goal_session_trades gst
      WHERE gst.goal_session_id = NEW.id
        AND gst.status = 'open'
    ) INTO v_has_open_trades;
    
    IF v_has_open_trades THEN
      RAISE WARNING '[Continuation SSOT] Session % has open trades - BLOCKING auto-close despite timeout', NEW.id;
      
      -- Clear awaiting_continuation state but keep session active
      -- This is an edge case - modal shouldn't have been triggered with open trades
      NEW.status := 'in_trade';  -- Correct status for session with open trades
      NEW.awaiting_continuation_since := NULL;
      
      -- Send warning notification to user
      INSERT INTO goal_notifications (user_id, session_id, type, title, message, priority, metadata)
      VALUES (
        NEW.user_id,
        NEW.id,
        'system_warning',
        'Session Timeout Blocked',
        'Session timeout was blocked because you have open trades. Session remains active.',
        'high',
        jsonb_build_object(
          'session_id', NEW.id,
          'reason', 'open_trades_safety_block',
          'open_trades_check', true
        )
      );
      
      RETURN NEW;  -- Return early - don't close session
    END IF;
    
    -- No open trades - safe to auto-close
    RAISE NOTICE '[Continuation SSOT] Auto-closing session % (timeout exceeded, no open trades)', NEW.id;
    
    NEW.status := 'user_stopped';
    NEW.completed_at := now();
    NEW.awaiting_continuation_since := NULL;
    
    -- Send notification to user
    INSERT INTO goal_notifications (user_id, session_id, type, title, message, priority, metadata)
    VALUES (
      NEW.user_id,
      NEW.id,
      'session_ended',
      'Session Auto-Closed',
      'Your session was automatically closed after 60 seconds with no response.',
      'medium',
      jsonb_build_object(
        'session_id', NEW.id,
        'reason', 'continuation_timeout',
        'timeout_seconds', 60,
        'open_trades_check', false
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_continuation_timeout_ssot IS
  'SSOT: Enforces 60-second timeout for awaiting_continuation status. NEVER closes sessions with open trades (defense-in-depth safety).';

-- ============================================================================
-- STEP 3: Update Cleanup Function with Same Safety Check
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_continuation_sessions_ssot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cleaned integer := 0;
  v_blocked integer := 0;
  v_session record;
  v_has_open_trades boolean;
BEGIN
  -- Find all sessions exceeding 60-second timeout
  FOR v_session IN
    SELECT id, user_id, awaiting_continuation_since,
           EXTRACT(EPOCH FROM (now() - awaiting_continuation_since)) as seconds_elapsed
    FROM goal_sessions
    WHERE status = 'awaiting_continuation'
      AND awaiting_continuation_since IS NOT NULL
      AND awaiting_continuation_since < now() - interval '60 seconds'
  LOOP
    -- CRITICAL SAFETY CHECK: Never auto-close if there are open trades
    SELECT EXISTS (
      SELECT 1
      FROM goal_session_trades gst
      WHERE gst.goal_session_id = v_session.id
        AND gst.status = 'open'
    ) INTO v_has_open_trades;
    
    IF v_has_open_trades THEN
      RAISE WARNING '[Cleanup SSOT] Session % has open trades - BLOCKING auto-close', v_session.id;
      
      -- Clear awaiting_continuation but keep session active
      UPDATE goal_sessions
      SET
        status = 'in_trade',
        awaiting_continuation_since = NULL,
        updated_at = now()
      WHERE id = v_session.id;
      
      -- Send warning notification
      INSERT INTO goal_notifications (user_id, session_id, type, title, message, priority, metadata)
      VALUES (
        v_session.user_id,
        v_session.id,
        'system_warning',
        'Session Timeout Blocked',
        'Session timeout was blocked because you have open trades. Session remains active.',
        'high',
        jsonb_build_object(
          'session_id', v_session.id,
          'reason', 'open_trades_safety_block',
          'open_trades_check', true
        )
      );
      
      v_blocked := v_blocked + 1;
      CONTINUE;  -- Don't close this session
    END IF;
    
    -- No open trades - safe to close
    UPDATE goal_sessions
    SET
      status = 'user_stopped',
      completed_at = now(),
      awaiting_continuation_since = NULL,
      updated_at = now()
    WHERE id = v_session.id;
    
    -- Send notification
    INSERT INTO goal_notifications (user_id, session_id, type, title, message, priority, metadata)
    VALUES (
      v_session.user_id,
      v_session.id,
      'session_ended',
      'Session Auto-Closed',
      format('Your session was automatically closed after %.0f seconds with no response.', v_session.seconds_elapsed),
      'medium',
      jsonb_build_object(
        'session_id', v_session.id,
        'reason', 'continuation_timeout',
        'timeout_seconds', 60,
        'actual_seconds', v_session.seconds_elapsed,
        'open_trades_check', false
      )
    );
    
    v_cleaned := v_cleaned + 1;
    
    RAISE NOTICE '[Cleanup SSOT] Closed session % (%.0f seconds elapsed, no open trades)', 
      v_session.id, v_session.seconds_elapsed;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'cleaned_count', v_cleaned,
    'blocked_count', v_blocked,
    'timestamp', now()
  );
END;
$$;

COMMENT ON FUNCTION cleanup_continuation_sessions_ssot IS
  'SSOT: Cleans up sessions stuck in awaiting_continuation beyond 60 seconds. NEVER closes sessions with open trades (defense-in-depth safety).';

-- ============================================================================
-- STEP 4: Verification
-- ============================================================================

DO $$
DECLARE
  v_trigger_has_safety_check boolean;
BEGIN
  -- Verify trigger includes open trades check
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'enforce_continuation_timeout_ssot'
      AND pg_get_functiondef(oid) LIKE '%v_has_open_trades%'
      AND pg_get_functiondef(oid) LIKE '%goal_session_trades%'
      AND pg_get_functiondef(oid) LIKE '%status = ''open''%'
  ) INTO v_trigger_has_safety_check;
  
  IF v_trigger_has_safety_check THEN
    RAISE NOTICE '[Safety Fix] ✅ Trigger now includes open trades safety check';
  ELSE
    RAISE EXCEPTION '[Safety Fix] ❌ Failed to add open trades safety check to trigger';
  END IF;
  
  RAISE NOTICE '[Safety Fix] ✅ Sessions with open trades will NEVER be auto-closed';
  RAISE NOTICE '[Safety Fix] ✅ Defense-in-depth safety layer now active';
END $$;
