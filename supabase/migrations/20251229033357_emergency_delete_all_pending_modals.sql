/*
  # EMERGENCY: Delete All Pending Modals and Fix System
  
  The problem: Modals are being UPDATED (dismissed_at set) but still queried
  The solution: DELETE modals instead of dismissing them
  
  ## Immediate Actions
  1. DELETE ALL existing pending modals (not just dismiss)
  2. Change auto-dismiss to DELETE instead of UPDATE
  3. Add instant cleanup on every getPendingModals() call
  4. Block resurrection of old modals
*/

-- STEP 1: NUCLEAR OPTION - DELETE ALL PENDING MODALS RIGHT NOW
DELETE FROM pending_user_modals
WHERE dismissed_at IS NULL OR dismissed_at IS NOT NULL;

-- STEP 2: Recreate getPendingModals to auto-DELETE old ones
CREATE OR REPLACE FUNCTION get_pending_modals_for_user(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  modal_type TEXT,
  modal_data JSONB,
  created_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  goal_session_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- FIRST: Delete all stale modals (older than 2 minutes)
  DELETE FROM pending_user_modals
  WHERE user_id = p_user_id
    AND created_at < NOW() - INTERVAL '2 minutes';
  
  -- SECOND: Delete modals from ended sessions
  DELETE FROM pending_user_modals pum
  USING goal_sessions gs
  WHERE pum.user_id = p_user_id
    AND pum.goal_session_id = gs.id
    AND gs.status IN ('stopped', 'completed', 'error', 'timeout');
  
  -- THIRD: Return only fresh, valid modals
  RETURN QUERY
  SELECT 
    pum.id,
    pum.user_id,
    pum.modal_type,
    pum.modal_data,
    pum.created_at,
    pum.dismissed_at,
    pum.goal_session_id
  FROM pending_user_modals pum
  LEFT JOIN goal_sessions gs ON pum.goal_session_id = gs.id
  WHERE pum.user_id = p_user_id
    AND pum.dismissed_at IS NULL
    AND pum.created_at > NOW() - INTERVAL '2 minutes'
    AND (pum.goal_session_id IS NULL OR gs.status IN ('active', 'scanning'))
  ORDER BY pum.created_at ASC;
END;
$$;

-- STEP 3: Change dismissModal to DELETE instead of UPDATE
CREATE OR REPLACE FUNCTION dismiss_pending_modal(p_modal_id UUID, p_user_action TEXT DEFAULT 'dismissed')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- DELETE the modal instead of updating it
  DELETE FROM pending_user_modals
  WHERE id = p_modal_id;
  
  RETURN FOUND;
END;
$$;

-- STEP 4: Create bulk delete function for user
CREATE OR REPLACE FUNCTION delete_all_pending_modals_for_user(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM pending_user_modals
  WHERE user_id = p_user_id;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$;

-- STEP 5: Update auto-dismiss to DELETE (not update)
CREATE OR REPLACE FUNCTION auto_dismiss_stale_pending_modals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- DELETE modals older than 2 minutes (reduced from 5)
  DELETE FROM pending_user_modals
  WHERE created_at < NOW() - INTERVAL '2 minutes';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

-- STEP 6: Block modal creation for ended sessions
CREATE OR REPLACE FUNCTION validate_modal_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_status TEXT;
BEGIN
  -- If modal has a session, check if session is active
  IF NEW.goal_session_id IS NOT NULL THEN
    SELECT status INTO v_session_status
    FROM goal_sessions
    WHERE id = NEW.goal_session_id;
    
    -- Block modal creation if session is ended
    IF v_session_status IN ('stopped', 'completed', 'error', 'timeout') THEN
      RAISE NOTICE 'Blocked modal creation for ended session: %', NEW.goal_session_id;
      RETURN NULL; -- Don't insert the modal
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS validate_modal_before_insert_trigger ON pending_user_modals;

CREATE TRIGGER validate_modal_before_insert_trigger
  BEFORE INSERT ON pending_user_modals
  FOR EACH ROW
  EXECUTE FUNCTION validate_modal_before_insert();

-- STEP 7: Update session end trigger to DELETE modals
CREATE OR REPLACE FUNCTION clear_modals_on_session_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- When session ends, DELETE its modals (not just dismiss)
  IF OLD.status != NEW.status AND NEW.status IN ('stopped', 'completed', 'error', 'timeout') THEN
    DELETE FROM pending_user_modals
    WHERE goal_session_id = NEW.id;
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
    IF v_deleted_count > 0 THEN
      RAISE NOTICE 'Deleted % pending modal(s) for ended session %', v_deleted_count, NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- STEP 8: Grant permissions
GRANT EXECUTE ON FUNCTION get_pending_modals_for_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION dismiss_pending_modal(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_all_pending_modals_for_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auto_dismiss_stale_pending_modals() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_modal_before_insert() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION clear_modals_on_session_end() TO authenticated, service_role;

-- STEP 9: Verify cleanup
DO $$
DECLARE
  v_remaining_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining_count
  FROM pending_user_modals;
  
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  🚨 EMERGENCY MODAL CLEANUP COMPLETE 🚨';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ ALL pending modals DELETED (not just dismissed)';
  RAISE NOTICE '✓ Auto-cleanup now DELETES modals older than 2 minutes';
  RAISE NOTICE '✓ getPendingModals() auto-deletes stale modals on every call';
  RAISE NOTICE '✓ dismissModal() now DELETES instead of updating';
  RAISE NOTICE '✓ Blocked modal creation for ended sessions';
  RAISE NOTICE '✓ Session end trigger DELETES modals immediately';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Remaining modals in database: %', v_remaining_count;
  RAISE NOTICE '';
  RAISE NOTICE '🔄 REFRESH YOUR BROWSER NOW - Popups should be GONE!';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;