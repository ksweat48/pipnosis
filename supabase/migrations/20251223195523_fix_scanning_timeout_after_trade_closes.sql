/*
  # Fix Scanning Timeout After Trade Closes
  
  ## Problem
  User stuck scanning for 55+ minutes after trade closed. Root cause:
  - Trade opened at 18:58:31, closed at 19:07:31 (hit stop loss)
  - Session continued scanning but `scanning_started_at` was never reset
  - `should_show_continuation_modal()` saw a trade created after `scanning_started_at` and returned false
  - User scanned for 47 minutes without trades, but timeout never triggered
  
  ## Solution
  1. Fix `should_show_continuation_modal()` to only check RECENT trades (last 15 min)
  2. Add trigger to auto-reset `scanning_started_at` when trade closes
  3. Emergency cleanup: Reset scanning_started_at for all currently scanning sessions
  
  ## Impact
  - 15-minute timeout will work correctly even after trades close
  - Prevents users from getting stuck scanning indefinitely
  - Sessions will always get the continuation modal after 15 min of no trades
*/

-- ============================================================================
-- STEP 1: Emergency cleanup - reset scanning_started_at for active sessions
-- ============================================================================

DO $$
DECLARE
  v_reset_count integer;
BEGIN
  WITH reset_sessions AS (
    UPDATE goal_sessions
    SET scanning_started_at = NOW()
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 15
    RETURNING id
  )
  SELECT COUNT(*) INTO v_reset_count FROM reset_sessions;
  
  IF v_reset_count > 0 THEN
    RAISE NOTICE '[Emergency Fix] Reset scanning_started_at for % sessions that were scanning >15 min', v_reset_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Fix should_show_continuation_modal() to check RECENT trades only
-- ============================================================================

CREATE OR REPLACE FUNCTION should_show_continuation_modal(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session record;
  v_elapsed_minutes numeric;
  v_has_recent_trades boolean;
  v_check_period_start timestamptz;
BEGIN
  -- Get session details
  SELECT
    scanning_started_at,
    scanning_duration_minutes,
    awaiting_continuation_confirmation,
    status
  INTO v_session
  FROM goal_sessions
  WHERE id = p_session_id;
  
  -- Not applicable if session not found or not in scanning status
  IF v_session IS NULL OR v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN false;
  END IF;
  
  -- Already showing modal
  IF v_session.awaiting_continuation_confirmation THEN
    RETURN false;
  END IF;
  
  -- Check if scanning started
  IF v_session.scanning_started_at IS NULL THEN
    RETURN false;
  END IF;
  
  -- Calculate elapsed time since scanning started
  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_session.scanning_started_at)) / 60;
  
  -- CRITICAL FIX: Only check for trades in the CURRENT scanning period
  -- This is the time since scanning_started_at, which should be reset after each trade
  v_check_period_start := v_session.scanning_started_at;
  
  -- Check if any trades were found in the current scanning period
  SELECT EXISTS (
    SELECT 1
    FROM goal_session_trades
    WHERE goal_session_id = p_session_id
      AND created_at >= v_check_period_start
  ) INTO v_has_recent_trades;
  
  -- Show modal if: elapsed time >= duration AND no trades found in current period
  RETURN v_elapsed_minutes >= v_session.scanning_duration_minutes AND NOT v_has_recent_trades;
END;
$$;

COMMENT ON FUNCTION should_show_continuation_modal IS
  'Returns true if session has been scanning for 15+ minutes without finding a trade in the CURRENT scanning period';

-- ============================================================================
-- STEP 3: Create trigger to reset scanning_started_at when trade closes
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_scanning_timer_on_trade_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_status text;
BEGIN
  -- Only trigger on status change to 'closed'
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    
    -- Check if session is now in scanning status (no other open trades)
    SELECT gs.status INTO v_session_status
    FROM goal_sessions gs
    WHERE gs.id = NEW.goal_session_id;
    
    -- If session returned to scanning, reset the timer
    IF v_session_status IN ('scanning', 'trade_pending') THEN
      UPDATE goal_sessions
      SET 
        scanning_started_at = NOW(),
        updated_at = NOW()
      WHERE id = NEW.goal_session_id;
      
      RAISE NOTICE '[Scanning Timer] Reset scanning_started_at for session % after trade % closed', NEW.goal_session_id, NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trigger_reset_scanning_timer_on_trade_close ON goal_session_trades;

-- Create trigger
CREATE TRIGGER trigger_reset_scanning_timer_on_trade_close
  AFTER UPDATE OF status ON goal_session_trades
  FOR EACH ROW
  WHEN (NEW.status = 'closed')
  EXECUTE FUNCTION reset_scanning_timer_on_trade_close();

COMMENT ON TRIGGER trigger_reset_scanning_timer_on_trade_close ON goal_session_trades IS
  'Resets scanning_started_at when a trade closes so the 15-minute timeout starts fresh';

-- ============================================================================
-- STEP 4: Add safety function to force-close sessions stuck >30 minutes
-- ============================================================================

CREATE OR REPLACE FUNCTION force_close_stale_scanning_sessions()
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  minutes_scanning numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH stale_sessions AS (
    UPDATE goal_sessions
    SET 
      status = 'user_stopped',
      completed_at = NOW(),
      awaiting_continuation_confirmation = false,
      continuation_confirmation_expires_at = NULL,
      updated_at = NOW()
    WHERE status IN ('scanning', 'trade_pending')
      AND scanning_started_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 > 30
    RETURNING 
      id as session_id,
      user_id,
      EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60 as minutes_scanning
  )
  SELECT * FROM stale_sessions;
END;
$$;

COMMENT ON FUNCTION force_close_stale_scanning_sessions IS
  'Safety net: Force-close any sessions that have been scanning >30 minutes without trades';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION should_show_continuation_modal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reset_scanning_timer_on_trade_close TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION force_close_stale_scanning_sessions TO service_role;
