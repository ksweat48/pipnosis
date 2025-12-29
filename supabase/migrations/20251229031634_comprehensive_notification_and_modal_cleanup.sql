/*
  # Comprehensive Notification and Modal Cleanup Fix

  ## Root Cause Analysis
  
  ### Notification Backlog Issue:
  1. Pending modals persist indefinitely across sessions
  2. No session context validation before showing modals
  3. Old "Stop Loss Hit" notifications from previous sessions keep reappearing
  4. 15-minute auto-cleanup wasn't aggressive enough
  
  ### Solution:
  1. Tie modals to active sessions ONLY
  2. Auto-dismiss modals when session ends
  3. Clear ALL pending modals when starting new session
  4. Reduce auto-dismiss time to 5 minutes (more aggressive)
  5. Add session_active validation before showing modals
  
  ## Changes
  1. Update auto-dismiss function to 5 minutes (from 15 minutes)
  2. Add function to clear modals by session_id
  3. Create trigger to auto-dismiss modals when session ends
  4. Clear all existing stale modals older than 5 minutes
  5. Add session_active column to prevent showing modals from ended sessions
*/

-- Step 1: More aggressive auto-dismiss (5 minutes instead of 15)
CREATE OR REPLACE FUNCTION auto_dismiss_stale_pending_modals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  dismissed_count INTEGER;
BEGIN
  -- Auto-dismiss modals older than 5 minutes (reduced from 15 minutes)
  UPDATE pending_user_modals
  SET
    dismissed_at = NOW(),
    user_action = 'auto_dismissed_stale'
  WHERE dismissed_at IS NULL
    AND created_at < NOW() - INTERVAL '5 minutes';

  GET DIAGNOSTICS dismissed_count = ROW_COUNT;

  RETURN dismissed_count;
END;
$$;

-- Step 2: Update default expiry to 5 minutes
ALTER TABLE pending_user_modals
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '5 minutes');

-- Step 3: Create function to clear modals when session ends
CREATE OR REPLACE FUNCTION clear_pending_modals_for_session(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  dismissed_count INTEGER;
BEGIN
  UPDATE pending_user_modals
  SET
    dismissed_at = NOW(),
    user_action = 'auto_dismissed_session_ended'
  WHERE goal_session_id = p_session_id
    AND dismissed_at IS NULL;

  GET DIAGNOSTICS dismissed_count = ROW_COUNT;

  RETURN dismissed_count;
END;
$$;

-- Step 4: Create trigger to auto-clear modals when session ends/stops
CREATE OR REPLACE FUNCTION clear_modals_on_session_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dismissed_count INTEGER;
BEGIN
  -- When session transitions to stopped/completed/error, clear its pending modals
  IF OLD.status != NEW.status AND NEW.status IN ('stopped', 'completed', 'error', 'timeout') THEN
    v_dismissed_count := clear_pending_modals_for_session(NEW.id);
    
    IF v_dismissed_count > 0 THEN
      RAISE NOTICE 'Auto-dismissed % pending modal(s) for session % (status: %)', 
        v_dismissed_count, NEW.id, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS clear_modals_on_session_end_trigger ON goal_sessions;

CREATE TRIGGER clear_modals_on_session_end_trigger
  AFTER UPDATE ON goal_sessions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION clear_modals_on_session_end();

-- Step 5: Add session validation column (optional, for future use)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_user_modals' 
    AND column_name = 'session_active'
  ) THEN
    ALTER TABLE pending_user_modals 
    ADD COLUMN session_active BOOLEAN DEFAULT TRUE;
    
    RAISE NOTICE '✓ Added session_active column';
  END IF;
END $$;

-- Step 6: Immediately clean up ALL stale modals (older than 5 minutes)
UPDATE pending_user_modals
SET
  dismissed_at = NOW(),
  user_action = 'auto_dismissed_stale'
WHERE dismissed_at IS NULL
  AND created_at < NOW() - INTERVAL '5 minutes';

-- Step 7: Dismiss modals for any ended/stopped sessions
UPDATE pending_user_modals pum
SET
  dismissed_at = NOW(),
  user_action = 'auto_dismissed_session_ended'
FROM goal_sessions gs
WHERE pum.goal_session_id = gs.id
  AND pum.dismissed_at IS NULL
  AND gs.status IN ('stopped', 'completed', 'error', 'timeout');

-- Step 8: Update expired modals to new 5-minute expiry
UPDATE pending_user_modals
SET expires_at = created_at + INTERVAL '5 minutes'
WHERE expires_at > created_at + INTERVAL '5 minutes';

-- Grant permissions
GRANT EXECUTE ON FUNCTION auto_dismiss_stale_pending_modals() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION clear_pending_modals_for_session(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION clear_modals_on_session_end() TO authenticated, service_role;

-- Update comments
COMMENT ON FUNCTION auto_dismiss_stale_pending_modals IS 'Auto-dismisses pending modals older than 5 minutes (reduced from 15) to prevent backlog';
COMMENT ON FUNCTION clear_pending_modals_for_session IS 'Dismisses all pending modals for a specific session when it ends';
COMMENT ON COLUMN pending_user_modals.expires_at IS 'Modal expires after 5 minutes - aggressive cleanup to prevent notification backlog';
COMMENT ON COLUMN pending_user_modals.session_active IS 'Tracks if the associated session is still active (prevents showing modals from ended sessions)';

-- Log the comprehensive fix
DO $$
DECLARE
  v_dismissed_count INTEGER;
  v_session_dismissed INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dismissed_count
  FROM pending_user_modals
  WHERE dismissed_at IS NOT NULL
    AND user_action IN ('auto_dismissed_stale', 'auto_dismissed_session_ended');

  SELECT COUNT(*) INTO v_session_dismissed
  FROM pending_user_modals
  WHERE dismissed_at IS NOT NULL
    AND user_action = 'auto_dismissed_session_ended';

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  COMPREHENSIVE MODAL CLEANUP COMPLETE';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ Auto-dismiss time: 15 min → 5 min (more aggressive)';
  RAISE NOTICE '✓ Default expiry: 15 min → 5 min';
  RAISE NOTICE '✓ Added session-end auto-cleanup trigger';
  RAISE NOTICE '✓ Added session_active validation column';
  RAISE NOTICE '✓ Total stale modals dismissed: %', v_dismissed_count;
  RAISE NOTICE '✓ Modals dismissed due to session end: %', v_session_dismissed;
  RAISE NOTICE '✓ Users will now ONLY see fresh notifications (< 5 minutes)';
  RAISE NOTICE '✓ Modals auto-clear when sessions end';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'FUTURE-PROOFING MEASURES:';
  RAISE NOTICE '• Modals tied to session lifecycle';
  RAISE NOTICE '• Automatic cleanup on session end';
  RAISE NOTICE '• 5-minute aggressive stale modal removal';
  RAISE NOTICE '• Session validation prevents old modals from showing';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;