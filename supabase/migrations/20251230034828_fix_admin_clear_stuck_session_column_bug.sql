/*
  # Fix Admin Function Column Name Bug

  ## Critical Issue
  The `admin_clear_stuck_goal_session()` function has a DOUBLE BUG:
  1. Uses wrong column name `session_id` instead of `goal_session_id`
  2. Compares parameter to itself: `WHERE session_id = session_id` (tautology - always TRUE)

  ## Impact
  - Function returns SUM of ALL trades in the database instead of just trades for the specific session
  - Admin dashboard shows incorrect progress values
  - Session clearing logic makes wrong decisions based on corrupted data
  - This breaks the AI learning system by clearing sessions incorrectly

  ## Fix
  Change `WHERE session_id = session_id` to `WHERE goal_session_id = session_id`
  where the left side is the table column and the right side is the function parameter

  ## Database Schema
  Confirmed via SQL query:
  - goal_session_trades table HAS column: goal_session_id ✅
  - goal_session_trades table DOES NOT HAVE column: session_id ❌
*/

-- Drop and recreate the function with correct column name
DROP FUNCTION IF EXISTS admin_clear_stuck_goal_session(uuid);

CREATE OR REPLACE FUNCTION admin_clear_stuck_goal_session(session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_record goal_sessions;
  current_progress numeric;
  open_trade_count integer;
  result jsonb;
BEGIN
  -- Verify admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Get session record
  SELECT * INTO session_record
  FROM goal_sessions
  WHERE id = session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found'
    );
  END IF;

  -- Check for open trades
  SELECT COUNT(*) INTO open_trade_count
  FROM goal_session_trades
  WHERE goal_session_id = session_id  -- ✅ FIXED: was "session_id = session_id"
    AND status = 'open';

  IF open_trade_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Session has %s open trade(s). Close trades first.', open_trade_count)
    );
  END IF;

  -- Calculate actual progress from trades
  -- ✅ CRITICAL FIX: Changed "session_id = session_id" to "goal_session_id = session_id"
  SELECT COALESCE(SUM(profit_loss), 0) INTO current_progress
  FROM goal_session_trades
  WHERE goal_session_id = session_id  -- ✅ FIXED: was "session_id = session_id"
    AND status IN ('closed', 'stopped', 'manual_close');

  -- Update session with correct progress
  UPDATE goal_sessions
  SET
    current_progress = current_progress,
    progress_percentage = CASE
      WHEN target_value > 0 THEN (current_progress / target_value) * 100
      ELSE 0
    END,
    status = CASE
      WHEN current_progress >= target_value THEN 'goal_achieved'
      WHEN status IN ('scanning', 'awaiting_entry', 'in_trade') THEN 'paused'
      ELSE status
    END,
    updated_at = now()
  WHERE id = session_id;

  result := jsonb_build_object(
    'success', true,
    'session_id', session_id,
    'calculated_progress', current_progress,
    'previous_progress', session_record.current_progress,
    'difference', current_progress - COALESCE(session_record.current_progress, 0),
    'status_updated', true
  );

  RETURN result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION admin_clear_stuck_goal_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_clear_stuck_goal_session(uuid) TO service_role;

COMMENT ON FUNCTION admin_clear_stuck_goal_session(uuid) IS
  'Admin function to recalculate and fix stuck goal session progress. FIXED: Uses goal_session_id not session_id';
