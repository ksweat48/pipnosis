/*
  # Fix admin_auto_correct_all_stuck_sessions Function

  ## Problem
  - Function references `session_id` column but actual column is `goal_session_id`

  ## Solution
  - Replace `gst.session_id` with `gst.goal_session_id`
*/

-- Drop existing function
DROP FUNCTION IF EXISTS admin_auto_correct_all_stuck_sessions();

-- Recreate with correct column name
CREATE OR REPLACE FUNCTION admin_auto_correct_all_stuck_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  stuck_session record;
  corrected_count integer := 0;
  session_results jsonb := '[]'::jsonb;
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

  -- Find all stuck sessions (scanning for > 15 minutes)
  FOR stuck_session IN
    SELECT
      gs.id,
      gs.user_id,
      gs.status,
      COALESCE(
        (SELECT SUM(profit_loss)
         FROM goal_session_trades gst
         WHERE gst.goal_session_id = gs.id
         AND gst.status IN ('closed', 'stopped', 'manual_close')),
        0
      ) AS calculated_progress
    FROM goal_sessions gs
    WHERE gs.status = 'scanning'
      AND gs.created_at < NOW() - INTERVAL '15 minutes'
  LOOP
    -- Update the stuck session
    UPDATE goal_sessions
    SET
      status = 'completed',
      current_progress = stuck_session.calculated_progress,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = stuck_session.id;

    -- Add to results
    session_results := session_results || jsonb_build_object(
      'session_id', stuck_session.id,
      'user_id', stuck_session.user_id,
      'old_status', stuck_session.status,
      'new_status', 'completed',
      'progress', stuck_session.calculated_progress
    );

    corrected_count := corrected_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'corrected_count', corrected_count,
    'sessions', session_results
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION admin_auto_correct_all_stuck_sessions() TO authenticated;
