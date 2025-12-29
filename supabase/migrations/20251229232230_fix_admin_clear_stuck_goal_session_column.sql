/*
  # Fix admin_clear_stuck_goal_session Function

  ## Problems
  1. Function references non-existent `goal_amount` jsonb column
  2. Actual column is `target_value` (numeric type)
  3. Parameter shadowing: `session_id` conflicts with variable usage

  ## Solution
  - Replace `(goal_amount->>'target_value')::numeric` with `target_value`
  - Rename parameter from `session_id` to `p_session_id` to avoid shadowing
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_clear_stuck_goal_session(uuid, uuid);

-- Recreate with correct column references
CREATE OR REPLACE FUNCTION admin_clear_stuck_goal_session(
  p_session_id uuid,
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  old_status text;
  current_progress numeric;
  target_value numeric;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();

  -- Check if calling user is admin
  SELECT up.is_admin INTO is_calling_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  -- Enforce admin-only access
  IF NOT COALESCE(is_calling_user_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Get session details (FIX: use target_value directly, not goal_amount->>'target_value')
  SELECT gs.status, gs.current_progress, gs.target_value
  INTO old_status, current_progress, target_value
  FROM goal_sessions gs
  WHERE gs.id = p_session_id AND gs.user_id = target_user_id;

  -- Validate session exists
  IF old_status IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  -- Check if session is actually stuck (scanning for > 15 minutes)
  IF old_status != 'scanning' THEN
    RAISE EXCEPTION 'Session is not in scanning status (current: %)', old_status;
  END IF;

  -- Calculate actual progress from trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO current_progress
  FROM goal_session_trades
  WHERE goal_session_id = p_session_id
    AND status IN ('closed', 'stopped', 'manual_close');

  -- Update session to completed status
  UPDATE goal_sessions
  SET
    status = 'completed',
    current_progress = current_progress,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_session_id;

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'old_status', old_status,
    'new_status', 'completed',
    'recalculated_progress', current_progress,
    'target_value', target_value
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_clear_stuck_goal_session(uuid, uuid) TO authenticated;
