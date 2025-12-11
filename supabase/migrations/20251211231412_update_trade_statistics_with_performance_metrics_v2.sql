/*
  # Update Trade Statistics Function with Performance Metrics

  This migration updates the get_trade_statistics function to include:
  - Average maximum drawdown across all trades
  - Average maximum profit (MFE) across all trades
  - Average pips per trade
  - Best pip performance (largest positive pip movement)
  - Worst pip performance (largest negative pip movement)

  These additional metrics help traders understand:
  1. Risk management effectiveness (drawdown)
  2. Opportunity capture (max profit/MFE)
  3. Technical performance in pips
*/

-- Drop the existing function first
DROP FUNCTION IF EXISTS get_trade_statistics(uuid);

-- Recreate with new return columns
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
  profit_factor numeric,
  average_max_drawdown numeric,
  average_max_profit numeric,
  average_pips numeric,
  best_pips numeric,
  worst_pips numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as total_trades,
    COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::bigint as winning_trades,
    COUNT(CASE WHEN profit_loss < 0 THEN 1 END)::bigint as losing_trades,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::numeric / COUNT(*)::numeric * 100), 2)
      ELSE 0
    END as win_rate,
    COALESCE(ROUND(SUM(CASE WHEN profit_loss > 0 THEN profit_loss END)::numeric, 2), 0) as total_profit,
    COALESCE(ROUND(SUM(CASE WHEN profit_loss < 0 THEN profit_loss END)::numeric, 2), 0) as total_loss,
    COALESCE(ROUND(SUM(profit_loss)::numeric, 2), 0) as net_profit,
    COALESCE(ROUND(AVG(CASE WHEN profit_loss > 0 THEN profit_loss END)::numeric, 2), 0) as average_win,
    COALESCE(ROUND(AVG(CASE WHEN profit_loss < 0 THEN profit_loss END)::numeric, 2), 0) as average_loss,
    COALESCE(ROUND(MAX(profit_loss)::numeric, 2), 0) as best_trade,
    COALESCE(ROUND(MIN(profit_loss)::numeric, 2), 0) as worst_trade,
    CASE
      WHEN SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) END) > 0 THEN
        ROUND((SUM(CASE WHEN profit_loss > 0 THEN profit_loss END) /
        SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) END))::numeric, 2)
      ELSE 0
    END as profit_factor,
    COALESCE(ROUND(AVG(max_drawdown)::numeric, 2), 0) as average_max_drawdown,
    COALESCE(ROUND(AVG(max_profit)::numeric, 2), 0) as average_max_profit,
    COALESCE(ROUND(AVG(total_pips)::numeric, 2), 0) as average_pips,
    COALESCE(ROUND(MAX(total_pips)::numeric, 2), 0) as best_pips,
    COALESCE(ROUND(MIN(total_pips)::numeric, 2), 0) as worst_pips
  FROM goal_session_trades
  WHERE user_id = p_user_id
    AND status = 'closed'
    AND closed_at IS NOT NULL
    AND profit_loss IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
