/*
  # Fix Ambiguous Column Reference in get_pending_modals_for_user

  ## Issue
  PostgreSQL error 42702: "column reference 'user_id' is ambiguous"
  
  The RAISE NOTICE statement references `user_id` without table qualification,
  causing ambiguity between:
  1. pending_user_modals.user_id (table column)
  2. user_id (function return type column)

  ## Fix
  Fully qualify all column references with table aliases
*/

DROP FUNCTION IF EXISTS get_pending_modals_for_user(UUID);

CREATE OR REPLACE FUNCTION get_pending_modals_for_user(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  modal_type TEXT,
  modal_data JSONB,
  created_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  goal_session_id UUID,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete ONLY modals with individual expires_at that have passed
  DELETE FROM pending_user_modals pum
  WHERE pum.user_id = p_user_id
    AND pum.expires_at IS NOT NULL
    AND pum.expires_at < NOW();

  RAISE NOTICE '[get_pending_modals] Cleaned expired modals for user %', p_user_id;

  -- Delete modals from definitively ended sessions
  DELETE FROM pending_user_modals pum
  WHERE pum.user_id = p_user_id
    AND pum.goal_session_id IN (
      SELECT gs.id
      FROM goal_sessions gs
      WHERE gs.id = pum.goal_session_id
        AND gs.status IN ('stopped', 'completed', 'error', 'user_stopped')
    );

  -- Return ALL valid modals (no 2-minute blanket deletion)
  RETURN QUERY
  SELECT
    pum.id,
    pum.user_id,
    pum.modal_type,
    pum.modal_data,
    pum.created_at,
    pum.dismissed_at,
    pum.goal_session_id,
    pum.expires_at
  FROM pending_user_modals pum
  LEFT JOIN goal_sessions gs ON pum.goal_session_id = gs.id
  WHERE pum.user_id = p_user_id
    AND pum.dismissed_at IS NULL
    AND (pum.expires_at IS NULL OR pum.expires_at >= NOW())
    AND (
      pum.goal_session_id IS NULL
      OR gs.status IN ('active', 'scanning', 'awaiting_continuation', 'trade_pending')
    )
  ORDER BY pum.created_at ASC;

  -- Fix: Fully qualify column references to avoid ambiguity
  RAISE NOTICE '[get_pending_modals] Returned % valid modals', (
    SELECT COUNT(*) 
    FROM pending_user_modals pum2
    WHERE pum2.user_id = p_user_id 
      AND pum2.dismissed_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_pending_modals_for_user(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION get_pending_modals_for_user IS
  'SSOT: Returns pending modals using expires_at column only (no blanket time deletion). Fixed ambiguous column references.';
