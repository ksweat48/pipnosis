/*
  # Fix Soft Closing Trigger Logic
  
  ## Problem
  The auto-update trigger for goal session status doesn't handle soft_closing properly.
  When a session is in 'soft_closing' state and the last trade closes, the trigger
  incorrectly transitions it to 'scanning' instead of 'expired'.
  
  ## Timeline of Bug
  1. Session running with open trades (status: 'in_trade')
  2. Timeframe expires → AI changes status to 'soft_closing'
  3. Last trade closes → Trigger sees no open trades
  4. ❌ Trigger changes 'soft_closing' → 'scanning' (WRONG!)
  5. Application tries to change it to 'expired' but trigger already changed it
  
  ## Solution
  Update the trigger to check for soft_closing state:
  - If session is 'soft_closing' and no trades remain → transition to 'expired'
  - If session is 'in_trade' and no trades remain → transition to 'scanning' (existing logic)
  - Preserve all other transitions
  
  ## Security
  - No RLS changes
  - Function remains SECURITY DEFINER for proper operation
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_session_status_on_trade_change ON goal_session_trades;
DROP FUNCTION IF EXISTS update_session_status_on_trade_change();

-- Updated function with soft_closing logic
CREATE OR REPLACE FUNCTION update_session_status_on_trade_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_trades_count INT;
  v_session_status TEXT;
  v_session_id UUID;
BEGIN
  -- Get the session ID (works for both INSERT and UPDATE)
  IF TG_OP = 'INSERT' THEN
    v_session_id := NEW.goal_session_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_session_id := NEW.goal_session_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Get current session status
  SELECT status INTO v_session_status
  FROM goal_sessions
  WHERE id = v_session_id;

  -- Count open trades for this session
  SELECT COUNT(*) INTO v_open_trades_count
  FROM goal_session_trades
  WHERE goal_session_id = v_session_id
  AND status = 'open';

  -- Update session status based on open trade count and current status
  IF v_open_trades_count > 0 THEN
    -- Has open trades: set to 'in_trade' if currently scanning
    IF v_session_status = 'scanning' THEN
      UPDATE goal_sessions
      SET
        status = 'in_trade',
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Session Status] Changed session % from scanning to in_trade (% open trades)', v_session_id, v_open_trades_count;
    END IF;
  ELSE
    -- No open trades: handle based on current status
    IF v_session_status = 'soft_closing' THEN
      -- CRITICAL FIX: Session was in soft_closing, now all trades closed → 'expired'
      UPDATE goal_sessions
      SET
        status = 'expired',
        end_time = COALESCE(end_time, NOW()),
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Session Status] Changed session % from soft_closing to expired (all trades closed after timeframe)', v_session_id;
      
    ELSIF v_session_status = 'in_trade' THEN
      -- Normal case: Session had trades, now closed → back to 'scanning'
      UPDATE goal_sessions
      SET
        status = 'scanning',
        updated_at = NOW()
      WHERE id = v_session_id;

      RAISE NOTICE '[Session Status] Changed session % from in_trade to scanning (no open trades)', v_session_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER update_session_status_on_trade_change
AFTER INSERT OR UPDATE OF status ON goal_session_trades
FOR EACH ROW
EXECUTE FUNCTION update_session_status_on_trade_change();

-- Update comment to reflect new behavior
COMMENT ON FUNCTION update_session_status_on_trade_change() IS 
  'Automatically updates goal session status based on trade activity. Handles soft_closing to expired when timeframe has expired. Handles in_trade to scanning for normal operation.';
