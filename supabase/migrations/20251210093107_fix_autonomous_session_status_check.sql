/*
  # Fix Autonomous Session Status Check
  
  1. Problem
    - Function was checking for status = 'active' (doesn't exist)
    - Real sessions use: 'scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing'
  
  2. Fix
    - Update function to check for actual valid statuses
    - Sessions with these statuses AND server_enabled=true will be processed
  
  3. Security
    - Maintains SECURITY DEFINER with existing access controls
*/

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
    gs.status IN ('scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing')
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
