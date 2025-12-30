/*
  # Create Position Recovery and Audit System

  ## Purpose
  1. Detect and recover stuck positions (positions that should have closed but didn't)
  2. Log all close attempts (success or failure) for debugging
  3. Provide admin visibility into position health
  4. Auto-recover positions with clear audit trail

  ## Components
  1. close_attempts audit table - logs every close attempt
  2. detect_stuck_positions() - finds positions in invalid states
  3. recover_stuck_positions() - attempts to fix stuck positions
  4. get_position_health_status() - returns health metrics per position

  ## Stuck Position Criteria
  A position is "stuck" if:
  - Status is 'open' but current_price hit SL or TP over 60 seconds ago
  - Status is 'soft_closing' for more than 5 minutes
  - Status is 'pending' but limit_price was hit over 60 seconds ago
  - Has close_attempts > 3 and still open
*/

-- 1. Create audit table for close attempts
CREATE TABLE IF NOT EXISTS position_close_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  goal_session_id uuid,
  attempt_time timestamptz NOT NULL DEFAULT now(),
  close_price numeric NOT NULL,
  close_reason text NOT NULL,
  success boolean NOT NULL,
  error_message text,
  closed_by text NOT NULL, -- 'database_trigger', 'position_monitor', 'manual', 'force_close', 'recovery_system'
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_close_attempts_trade_id ON position_close_attempts(trade_id);
CREATE INDEX IF NOT EXISTS idx_close_attempts_user_id ON position_close_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_close_attempts_time ON position_close_attempts(attempt_time DESC);
CREATE INDEX IF NOT EXISTS idx_close_attempts_success ON position_close_attempts(success) WHERE success = false;

-- RLS policies
ALTER TABLE position_close_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own close attempts"
  ON position_close_attempts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access to close attempts"
  ON position_close_attempts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Add metadata columns to goal_session_trades for tracking
ALTER TABLE goal_session_trades 
  ADD COLUMN IF NOT EXISTS last_tp_sl_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_attempts_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_close_attempt_error text,
  ADD COLUMN IF NOT EXISTS force_closed boolean DEFAULT false;

-- 3. Function to detect stuck positions
CREATE OR REPLACE FUNCTION detect_stuck_positions()
RETURNS TABLE (
  trade_id uuid,
  symbol text,
  status text,
  stuck_reason text,
  seconds_stuck integer,
  current_price numeric,
  stop_loss numeric,
  take_profit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gst.id AS trade_id,
    gst.symbol,
    gst.status,
    CASE
      -- Case 1: Position hit SL/TP but didn't close
      WHEN gst.status = 'open' 
        AND gst.direction = 'buy' 
        AND gst.current_price IS NOT NULL
        AND (gst.current_price >= gst.take_profit OR gst.current_price <= gst.stop_loss)
        AND EXTRACT(EPOCH FROM (now() - COALESCE(gst.last_tp_sl_check_at, gst.updated_at))) > 60
      THEN 'Open position hit SL/TP but did not close'
      
      WHEN gst.status = 'open' 
        AND gst.direction = 'sell' 
        AND gst.current_price IS NOT NULL
        AND (gst.current_price <= gst.take_profit OR gst.current_price >= gst.stop_loss)
        AND EXTRACT(EPOCH FROM (now() - COALESCE(gst.last_tp_sl_check_at, gst.updated_at))) > 60
      THEN 'Open position hit SL/TP but did not close'
      
      -- Case 2: Stuck in soft_closing for too long
      WHEN gst.status = 'soft_closing' 
        AND EXTRACT(EPOCH FROM (now() - gst.updated_at)) > 300
      THEN 'Stuck in soft_closing for over 5 minutes'
      
      -- Case 3: Multiple failed close attempts
      WHEN gst.status = 'open' 
        AND gst.close_attempts_count > 3
      THEN format('Has %s failed close attempts', gst.close_attempts_count)
      
      -- Case 4: Pending order stuck
      WHEN gst.status = 'pending'
        AND gst.limit_price IS NOT NULL
        AND gst.current_price IS NOT NULL
        AND (
          (gst.direction = 'buy' AND gst.current_price <= gst.limit_price) OR
          (gst.direction = 'sell' AND gst.current_price >= gst.limit_price)
        )
        AND EXTRACT(EPOCH FROM (now() - gst.updated_at)) > 60
      THEN 'Pending order should have filled but did not'
      
      ELSE NULL
    END AS stuck_reason,
    EXTRACT(EPOCH FROM (now() - gst.updated_at))::integer AS seconds_stuck,
    gst.current_price,
    gst.stop_loss,
    gst.take_profit
  FROM goal_session_trades gst
  WHERE gst.status IN ('open', 'pending', 'soft_closing')
    AND CASE
      -- Only include positions that match stuck criteria
      WHEN gst.status = 'open' 
        AND gst.current_price IS NOT NULL
        AND (
          (gst.direction = 'buy' AND (gst.current_price >= gst.take_profit OR gst.current_price <= gst.stop_loss)) OR
          (gst.direction = 'sell' AND (gst.current_price <= gst.take_profit OR gst.current_price >= gst.stop_loss))
        )
        AND EXTRACT(EPOCH FROM (now() - COALESCE(gst.last_tp_sl_check_at, gst.updated_at))) > 60
      THEN true
      
      WHEN gst.status = 'soft_closing' 
        AND EXTRACT(EPOCH FROM (now() - gst.updated_at)) > 300
      THEN true
      
      WHEN gst.status = 'open' AND gst.close_attempts_count > 3
      THEN true
      
      WHEN gst.status = 'pending'
        AND gst.limit_price IS NOT NULL
        AND gst.current_price IS NOT NULL
        AND (
          (gst.direction = 'buy' AND gst.current_price <= gst.limit_price) OR
          (gst.direction = 'sell' AND gst.current_price >= gst.limit_price)
        )
        AND EXTRACT(EPOCH FROM (now() - gst.updated_at)) > 60
      THEN true
      
      ELSE false
    END;
END;
$$;

-- 4. Function to recover stuck positions
CREATE OR REPLACE FUNCTION recover_stuck_positions()
RETURNS TABLE (
  trade_id uuid,
  symbol text,
  recovery_action text,
  success boolean,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stuck_position RECORD;
  v_close_price numeric;
  v_close_reason text;
  v_success boolean;
  v_error text;
BEGIN
  -- Find all stuck positions
  FOR v_stuck_position IN 
    SELECT * FROM detect_stuck_positions()
  LOOP
    BEGIN
      v_success := false;
      v_error := NULL;
      
      -- Determine close price and reason based on stuck reason
      IF v_stuck_position.stuck_reason LIKE '%hit SL/TP%' THEN
        -- Determine if SL or TP was hit
        IF v_stuck_position.current_price >= v_stuck_position.take_profit THEN
          v_close_price := v_stuck_position.take_profit;
          v_close_reason := 'take_profit';
        ELSIF v_stuck_position.current_price <= v_stuck_position.stop_loss THEN
          v_close_price := v_stuck_position.stop_loss;
          v_close_reason := 'stop_loss';
        ELSE
          v_close_price := v_stuck_position.current_price;
          v_close_reason := 'safety_net';
        END IF;
        
        -- Attempt to close with force if needed
        PERFORM close_goal_session_trade(
          v_stuck_position.trade_id,
          v_close_price,
          v_close_reason,
          NULL,
          true -- force close
        );
        
        v_success := true;
        
      ELSIF v_stuck_position.stuck_reason LIKE '%soft_closing%' THEN
        -- Force close at current price
        v_close_price := v_stuck_position.current_price;
        v_close_reason := 'timeout';
        
        PERFORM close_goal_session_trade(
          v_stuck_position.trade_id,
          v_close_price,
          v_close_reason,
          NULL,
          true
        );
        
        v_success := true;
        
      ELSIF v_stuck_position.stuck_reason LIKE '%failed close attempts%' THEN
        -- Force close at current price
        v_close_price := v_stuck_position.current_price;
        v_close_reason := 'safety_net';
        
        PERFORM close_goal_session_trade(
          v_stuck_position.trade_id,
          v_close_price,
          v_close_reason,
          NULL,
          true
        );
        
        v_success := true;
        
      END IF;
      
      -- Log successful recovery
      INSERT INTO position_close_attempts (
        trade_id,
        user_id,
        goal_session_id,
        close_price,
        close_reason,
        success,
        closed_by,
        metadata
      )
      SELECT 
        v_stuck_position.trade_id,
        gst.user_id,
        gst.goal_session_id,
        v_close_price,
        v_close_reason,
        v_success,
        'recovery_system',
        jsonb_build_object(
          'stuck_reason', v_stuck_position.stuck_reason,
          'seconds_stuck', v_stuck_position.seconds_stuck
        )
      FROM goal_session_trades gst
      WHERE gst.id = v_stuck_position.trade_id;
      
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      v_success := false;
      
      -- Log failed recovery attempt
      INSERT INTO position_close_attempts (
        trade_id,
        user_id,
        goal_session_id,
        close_price,
        close_reason,
        success,
        error_message,
        closed_by,
        metadata
      )
      SELECT 
        v_stuck_position.trade_id,
        gst.user_id,
        gst.goal_session_id,
        v_close_price,
        v_close_reason,
        false,
        v_error,
        'recovery_system',
        jsonb_build_object(
          'stuck_reason', v_stuck_position.stuck_reason,
          'seconds_stuck', v_stuck_position.seconds_stuck
        )
      FROM goal_session_trades gst
      WHERE gst.id = v_stuck_position.trade_id;
    END;
    
    -- Return result
    RETURN QUERY SELECT 
      v_stuck_position.trade_id,
      v_stuck_position.symbol,
      v_stuck_position.stuck_reason,
      v_success,
      v_error;
  END LOOP;
END;
$$;

-- Grant permissions
GRANT SELECT ON position_close_attempts TO authenticated;
GRANT EXECUTE ON FUNCTION detect_stuck_positions() TO authenticated;
GRANT EXECUTE ON FUNCTION detect_stuck_positions() TO service_role;
GRANT EXECUTE ON FUNCTION recover_stuck_positions() TO service_role;

COMMENT ON TABLE position_close_attempts IS 
  'Audit trail of all position close attempts. Logs success/failure for debugging stuck positions.';

COMMENT ON FUNCTION detect_stuck_positions() IS
  'Detects positions that are stuck in invalid states and should have closed. Returns list with stuck reason and duration.';

COMMENT ON FUNCTION recover_stuck_positions() IS
  'Attempts to recover all stuck positions by force-closing them. Should be run by cron job every 60 seconds as emergency backup.';
