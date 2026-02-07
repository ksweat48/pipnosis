/*
  # Ghost Session Prevention and Cleanup

  1. Problem
    - Goal sessions can get stuck in 'in_trade' status even after all trades are closed
    - This causes the polling orchestrator to maintain unnecessary polling
    - Sessions remain "active" for days after trades complete

  2. Solution
    - Create automated cleanup function to detect and fix ghost sessions
    - Add trigger to auto-complete sessions when last trade closes
    - Add RPC for manual cleanup queries

  3. Ghost Session Definition
    - Status = 'in_trade'
    - All associated trades are closed (status != 'open')
    - OR no trades exist for the session

  TIER7 FIX: Prevents ghost sessions from blocking system health degradation
*/

-- Function to find ghost sessions
CREATE OR REPLACE FUNCTION find_ghost_sessions()
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  session_status text,
  created_at timestamptz,
  updated_at timestamptz,
  days_stuck integer,
  open_trades_count bigint,
  closed_trades_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gs.id as session_id,
    gs.user_id,
    gs.status as session_status,
    gs.created_at,
    gs.updated_at,
    EXTRACT(DAY FROM NOW() - gs.updated_at)::integer as days_stuck,
    COUNT(gst.id) FILTER (WHERE gst.status = 'open')::bigint as open_trades_count,
    COUNT(gst.id) FILTER (WHERE gst.status != 'open')::bigint as closed_trades_count
  FROM goal_sessions gs
  LEFT JOIN goal_session_trades gst ON gst.goal_session_id = gs.id
  WHERE gs.status = 'in_trade'
  GROUP BY gs.id, gs.user_id, gs.status, gs.created_at, gs.updated_at
  HAVING COUNT(gst.id) FILTER (WHERE gst.status = 'open') = 0;
END;
$$;

-- Function to cleanup ghost sessions
CREATE OR REPLACE FUNCTION cleanup_ghost_sessions()
RETURNS TABLE (
  session_id uuid,
  previous_status text,
  new_status text,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ghost_sessions AS (
    SELECT 
      gs.id,
      gs.status,
      MAX(gst.closed_at) as last_trade_closed_at
    FROM goal_sessions gs
    LEFT JOIN goal_session_trades gst ON gst.goal_session_id = gs.id
    WHERE gs.status = 'in_trade'
    GROUP BY gs.id, gs.status
    HAVING COUNT(gst.id) FILTER (WHERE gst.status = 'open') = 0
  ),
  updated_sessions AS (
    UPDATE goal_sessions gs
    SET 
      status = 'system_stopped',
      completed_at = COALESCE(
        (SELECT last_trade_closed_at FROM ghost_sessions WHERE ghost_sessions.id = gs.id),
        NOW()
      ),
      updated_at = NOW()
    FROM ghost_sessions
    WHERE gs.id = ghost_sessions.id
    RETURNING gs.id, ghost_sessions.status as prev_status, gs.status as new_status, gs.completed_at
  )
  SELECT 
    us.id as session_id,
    us.prev_status as previous_status,
    us.new_status,
    us.completed_at
  FROM updated_sessions us;
END;
$$;

-- Trigger function to auto-complete session when last trade closes
CREATE OR REPLACE FUNCTION auto_complete_session_on_trade_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_open_trades_count integer;
  v_session_status text;
BEGIN
  -- Only process if trade was closed (status changed to closed or trade is closing)
  IF (TG_OP = 'UPDATE' AND NEW.status != OLD.status AND NEW.status = 'closed') 
     OR (TG_OP = 'UPDATE' AND NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL) THEN
    
    -- Get session status
    SELECT status INTO v_session_status
    FROM goal_sessions
    WHERE id = NEW.goal_session_id;

    -- Only process if session is still in_trade
    IF v_session_status = 'in_trade' THEN
      -- Count remaining open trades in this session
      SELECT COUNT(*) INTO v_open_trades_count
      FROM goal_session_trades
      WHERE goal_session_id = NEW.goal_session_id
        AND status = 'open'
        AND id != NEW.id; -- Exclude current trade

      -- If no more open trades, mark session as system_stopped
      IF v_open_trades_count = 0 THEN
        UPDATE goal_sessions
        SET 
          status = 'system_stopped',
          completed_at = NEW.closed_at,
          updated_at = NOW()
        WHERE id = NEW.goal_session_id
          AND status = 'in_trade'; -- Safety check

        RAISE NOTICE 'Auto-completed session % after trade % closed', NEW.goal_session_id, NEW.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on goal_session_trades
DROP TRIGGER IF EXISTS trigger_auto_complete_session_on_trade_close ON goal_session_trades;
CREATE TRIGGER trigger_auto_complete_session_on_trade_close
  AFTER UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION auto_complete_session_on_trade_close();

-- Grant permissions
GRANT EXECUTE ON FUNCTION find_ghost_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION find_ghost_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_ghost_sessions() TO service_role;

-- Create index to speed up ghost session detection
CREATE INDEX IF NOT EXISTS idx_goal_sessions_status_in_trade 
  ON goal_sessions(status) 
  WHERE status = 'in_trade';

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_status_open 
  ON goal_session_trades(goal_session_id, status) 
  WHERE status = 'open';

COMMENT ON FUNCTION find_ghost_sessions() IS 'Finds goal sessions stuck in in_trade status with no open trades';
COMMENT ON FUNCTION cleanup_ghost_sessions() IS 'Automatically fixes ghost sessions by marking them as system_stopped';
COMMENT ON FUNCTION auto_complete_session_on_trade_close() IS 'Trigger function that auto-completes sessions when last trade closes';
