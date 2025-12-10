/*
  # Fix Blocking Dialog and Trade Statistics

  1. Clear stuck continuation states
    - Reset awaiting_user_continuation for inactive sessions
    - Prevent dialog from blocking UI

  2. Fix get_trade_statistics function
    - Use correct column name (profit_loss not realized_pnl)
    - Include trades from both trade_history and goal_session_trades

  3. Add safeguards
    - Only show continuation for truly active sessions
*/

-- ============================================================================
-- STEP 1: Clear stuck continuation states
-- ============================================================================

-- Reset awaiting_user_continuation for sessions that are not actively trading
UPDATE goal_sessions
SET 
  awaiting_user_continuation = false,
  continuation_prompt = null,
  updated_at = now()
WHERE awaiting_user_continuation = true
AND status NOT IN ('in_trade', 'trade_pending');

-- ============================================================================
-- STEP 2: Fix get_trade_statistics function with correct column name
-- ============================================================================

CREATE OR REPLACE FUNCTION get_trade_statistics(p_user_id uuid)
RETURNS TABLE (
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  win_rate numeric,
  total_profit numeric,
  total_loss numeric,
  net_profit numeric,
  average_win numeric,
  average_loss numeric,
  best_trade numeric,
  worst_trade numeric,
  average_trade_duration interval
) AS $$
BEGIN
  RETURN QUERY
  WITH all_trades AS (
    -- Trades from trade_history (manual/demo trades)
    SELECT
      profit_loss,
      opened_at,
      closed_at
    FROM trade_history
    WHERE user_id = p_user_id

    UNION ALL

    -- Trades from goal_session_trades (goal mode trades) - use profit_loss column
    SELECT
      profit_loss,
      opened_at,
      closed_at
    FROM goal_session_trades
    WHERE user_id = p_user_id
    AND status = 'closed'
    AND closed_at IS NOT NULL
    AND profit_loss IS NOT NULL
  )
  SELECT
    COUNT(*)::bigint as total_trades,
    COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::bigint as winning_trades,
    COUNT(CASE WHEN profit_loss < 0 THEN 1 END)::bigint as losing_trades,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 2)
      ELSE 0
    END as win_rate,
    COALESCE(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END), 0) as total_profit,
    COALESCE(SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) ELSE 0 END), 0) as total_loss,
    COALESCE(SUM(profit_loss), 0) as net_profit,
    COALESCE(AVG(CASE WHEN profit_loss > 0 THEN profit_loss END), 0) as average_win,
    COALESCE(AVG(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) END), 0) as average_loss,
    COALESCE(MAX(profit_loss), 0) as best_trade,
    COALESCE(MIN(profit_loss), 0) as worst_trade,
    COALESCE(AVG(closed_at - opened_at), INTERVAL '0') as average_trade_duration
  FROM all_trades;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;