/*
  # Add Force-Close Capability for Stuck Positions

  ## Problem
  Users cannot manually close positions that get stuck in invalid states because
  the close_goal_session_trade() function has strict status validation that only
  allows closing positions with status IN ('open', 'pending', 'soft_closing').

  If a position gets stuck in 'closed' status but wasn't properly closed, or has
  other data anomalies, users are locked out of fixing it manually.

  ## Solution
  Add optional p_force_close parameter that:
  1. Bypasses status validation when set to true
  2. Allows closing from ANY status
  3. Logs force-close operations for audit trail
  4. Requires explicit user confirmation (handled in UI)

  ## Changes
  1. Add p_force_close BOOLEAN DEFAULT false parameter
  2. Add conditional status validation
  3. Add force-close logging
  4. Improve error messages with specific rejection reasons
*/

-- Drop existing function (need to change signature)
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid);

-- Recreate with force_close parameter
CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL,
  p_force_close boolean DEFAULT false
) RETURNS SETOF goal_session_trades
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
BEGIN
  -- Validate close reason
  IF p_close_reason NOT IN (
    'manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 
    'session_ended', 'risk_limit', 'trailing_stop', 'timeout', 'safety_net',
    'user_stopped', 'breakeven', 'alpha_override', 'ai_decision', 'goal_met'
  ) THEN
    RAISE EXCEPTION 'Invalid close_reason: %. Must be one of the valid close reasons.', p_close_reason;
  END IF;

  -- Get trade details with conditional status validation
  IF p_goal_session_id IS NOT NULL THEN
    IF p_force_close THEN
      -- Force close: allow ANY status
      SELECT * INTO v_trade
      FROM goal_session_trades
      WHERE id = p_trade_id
        AND goal_session_id = p_goal_session_id;
        
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found or wrong session', p_trade_id;
      END IF;
      
      -- Log force close
      RAISE NOTICE '[FORCE CLOSE] Position % force-closed from status: %', p_trade_id, v_trade.status;
    ELSE
      -- Normal close: validate status
      SELECT * INTO v_trade
      FROM goal_session_trades
      WHERE id = p_trade_id
        AND goal_session_id = p_goal_session_id
        AND status IN ('open', 'pending', 'soft_closing');
        
      IF NOT FOUND THEN
        -- Check if trade exists but has wrong status
        PERFORM 1 FROM goal_session_trades
        WHERE id = p_trade_id AND goal_session_id = p_goal_session_id;
        
        IF FOUND THEN
          -- Trade exists but wrong status
          SELECT status INTO v_trade FROM goal_session_trades WHERE id = p_trade_id;
          RAISE EXCEPTION 'Trade % has status "%" which cannot be closed normally. Current status must be open, pending, or soft_closing. Use force-close if needed.', 
            p_trade_id, v_trade.status;
        ELSE
          -- Trade not found at all
          RAISE EXCEPTION 'Trade % not found in session %', p_trade_id, p_goal_session_id;
        END IF;
      END IF;
    END IF;
  ELSE
    -- No session specified
    IF p_force_close THEN
      SELECT * INTO v_trade
      FROM goal_session_trades
      WHERE id = p_trade_id;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
      END IF;
      
      RAISE NOTICE '[FORCE CLOSE] Position % force-closed from status: %', p_trade_id, v_trade.status;
    ELSE
      SELECT * INTO v_trade
      FROM goal_session_trades
      WHERE id = p_trade_id
        AND status IN ('open', 'pending', 'soft_closing');
        
      IF NOT FOUND THEN
        PERFORM 1 FROM goal_session_trades WHERE id = p_trade_id;
        
        IF FOUND THEN
          SELECT status INTO v_trade FROM goal_session_trades WHERE id = p_trade_id;
          RAISE EXCEPTION 'Trade % has status "%" which cannot be closed. Use force-close if needed.', 
            p_trade_id, v_trade.status;
        ELSE
          RAISE EXCEPTION 'Trade % not found', p_trade_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Verify access (user owns it or service role)
  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: trade belongs to different user';
  END IF;

  -- Skip if already closed (unless force closing)
  IF v_trade.status = 'closed' AND NOT p_force_close THEN
    RAISE EXCEPTION 'Trade % is already closed at %', p_trade_id, v_trade.closed_at;
  END IF;

  -- Calculate P&L using proper forex pip calculation
  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.01;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000;
  ELSIF v_trade.symbol LIKE 'BTC%' OR v_trade.symbol LIKE 'ETH%' THEN
    -- Crypto: use percentage-based calculation
    v_pip_distance := ((p_close_price - v_trade.entry_price) / v_trade.entry_price) * 100;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * v_trade.entry_price / 100;
  ELSE
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.0001;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10;
  END IF;

  -- Calculate P&L based on direction
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_calculated_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  -- Update the trade record
  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
    close_reason = CASE 
      WHEN p_force_close THEN 'manual' -- Force closes are always manual
      ELSE p_close_reason 
    END,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now()
  WHERE id = p_trade_id;

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User profile not found for user_id: %', v_trade.user_id;
  END IF;

  -- Only update balance if position wasn't already closed
  IF v_trade.status != 'closed' THEN
    v_new_balance := v_current_balance + v_calculated_pnl;

    -- Update user balance
    UPDATE user_profiles
    SET account_balance = v_new_balance,
        updated_at = now()
    WHERE id = v_trade.user_id;
    
    RAISE NOTICE '[CLOSE] Balance updated: % + % = %', v_current_balance, v_calculated_pnl, v_new_balance;
  ELSE
    RAISE NOTICE '[FORCE CLOSE] Skipped balance update - position was already closed';
  END IF;

  -- Log force close in notifications if applicable
  IF p_force_close THEN
    INSERT INTO goal_notifications (
      goal_session_id,
      user_id,
      type,
      priority,
      title,
      message,
      metadata,
      channels
    ) VALUES (
      v_trade.goal_session_id,
      v_trade.user_id,
      'system_alert',
      'high',
      '🔧 Position Force-Closed',
      format('Position %s was force-closed manually. Previous status: %s', v_trade.symbol, v_trade.status),
      jsonb_build_object(
        'trade_id', p_trade_id,
        'symbol', v_trade.symbol,
        'previous_status', v_trade.status,
        'close_price', p_close_price,
        'pnl', v_calculated_pnl,
        'force_closed', true
      ),
      ARRAY['in_app']
    );
  END IF;

  -- Return full updated record
  RETURN QUERY
  SELECT * FROM goal_session_trades
  WHERE id = p_trade_id;
END;
$$;

COMMENT ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean) IS
  'Closes a goal session trade with optional force-close capability. When p_force_close is true, bypasses status validation to allow closing stuck positions. Always logs force-close operations.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean) TO service_role;
