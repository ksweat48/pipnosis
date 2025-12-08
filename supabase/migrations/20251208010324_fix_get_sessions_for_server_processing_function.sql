/*
  # Fix get_sessions_for_server_processing Function
  
  1. Changes
    - Fix column references to match actual goal_sessions schema
    - Change `symbol` to `watchlist` (array)
    - Change `target_amount` to `target_value`
    - Change `current_pnl` to `current_progress`
    - Add proper return type definition
  
  2. Security
    - Function remains secure with existing access controls
*/

-- Drop and recreate with correct column names
DROP FUNCTION IF EXISTS get_sessions_for_server_processing();

CREATE OR REPLACE FUNCTION get_sessions_for_server_processing()
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  watchlist text[],
  target_value numeric,
  current_progress numeric,
  server_last_check timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gs.id as session_id,
    gs.user_id,
    gs.watchlist,
    gs.target_value,
    gs.current_progress,
    gs.server_last_check
  FROM goal_sessions gs
  WHERE 
    gs.status = 'active'
    AND gs.server_enabled = true
    AND gs.autonomous_enabled = true
    AND (
      gs.server_last_check IS NULL 
      OR gs.server_last_check < now() - INTERVAL '30 seconds'
    )
  ORDER BY 
    COALESCE(gs.server_last_check, gs.created_at) ASC
  LIMIT 50;
END;
$$;