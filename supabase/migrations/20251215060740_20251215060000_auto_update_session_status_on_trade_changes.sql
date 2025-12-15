/*
  # Auto-update goal session status based on trade status

  1. Changes
    - Add trigger function to update session status when trades open/close
    - When first trade opens: change session status from 'scanning' to 'in_trade'
    - When last trade closes: change session status from 'in_trade' back to 'scanning'
    - Handles both INSERT (new trades) and UPDATE (trade status changes)

  2. Security
    - Function runs with security definer to bypass RLS
    - Only affects goal_sessions table based on trade changes
*/

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_session_status_on_trade_change ON goal_session_trades;
DROP FUNCTION IF EXISTS update_session_status_on_trade_change();

-- Function to update session status based on trade activity
CREATE OR REPLACE FUNCTION update_session_status_on_trade_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_open_trades_count INT;
  v_session_status TEXT;
BEGIN
  -- Get the session ID (works for both INSERT and UPDATE)
  DECLARE
    v_session_id UUID;
  BEGIN
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

    -- Update session status based on open trade count
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
      -- No open trades: set back to 'scanning' if currently in_trade
      IF v_session_status = 'in_trade' THEN
        UPDATE goal_sessions
        SET
          status = 'scanning',
          updated_at = NOW()
        WHERE id = v_session_id;

        RAISE NOTICE '[Session Status] Changed session % from in_trade to scanning (no open trades)', v_session_id;
      END IF;
    END IF;
  END;

  RETURN NEW;
END;
$$;

-- Create trigger for INSERT (new trades opened)
CREATE TRIGGER update_session_status_on_trade_change
AFTER INSERT OR UPDATE OF status ON goal_session_trades
FOR EACH ROW
EXECUTE FUNCTION update_session_status_on_trade_change();

-- Add comment
COMMENT ON FUNCTION update_session_status_on_trade_change() IS 'Automatically updates goal session status to in_trade when trades open and back to scanning when all trades close';