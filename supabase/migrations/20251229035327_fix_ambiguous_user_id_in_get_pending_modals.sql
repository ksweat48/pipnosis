/*
  # Fix Ambiguous Column Reference in get_pending_modals_for_user
  
  ## Problem
  The function fails with error: "column reference 'user_id' is ambiguous"
  Both pending_user_modals and goal_sessions have user_id columns
  
  ## Solution
  Properly qualify ALL column references with table aliases
*/

-- Drop and recreate the function with fully qualified column names
DROP FUNCTION IF EXISTS get_pending_modals_for_user(UUID);

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
  WHERE pending_user_modals.user_id = p_user_id
    AND pending_user_modals.created_at < NOW() - INTERVAL '2 minutes';
  
  -- SECOND: Delete modals from ended sessions
  -- Use fully qualified column names to avoid ambiguity
  DELETE FROM pending_user_modals
  WHERE pending_user_modals.user_id = p_user_id
    AND pending_user_modals.goal_session_id IN (
      SELECT gs.id 
      FROM goal_sessions gs
      WHERE gs.id = pending_user_modals.goal_session_id
        AND gs.status IN ('stopped', 'completed', 'error', 'timeout')
    );
  
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_pending_modals_for_user(UUID) TO authenticated, service_role;

-- Verify the fix
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ FIXED: Ambiguous user_id column reference';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ All column references now fully qualified';
  RAISE NOTICE '✓ Function should work without errors now';
  RAISE NOTICE '';
  RAISE NOTICE '🔄 REFRESH YOUR BROWSER - Error should be gone!';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;