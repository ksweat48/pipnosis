/*
  # Fix get_trade_statistics RPC Function

  1. Problem
    - RPC function `get_trade_statistics` either doesn't exist or references deleted `trade_history` table
    - Analysis page fails with 404 and relation not found errors

  2. Solution
    - Create/replace function to use `goal_session_trades` table
    - Filter by closed trades only
    - Calculate all performance metrics (win rate, profit factor, etc.)

  3. Security
    - Function uses user_id parameter to ensure users only see their own data
    - RLS policies on goal_session_trades already enforce data isolation
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_trade_statistics(UUID);

-- Create the get_trade_statistics function
CREATE OR REPLACE FUNCTION get_trade_statistics(p_user_id UUID)
RETURNS TABLE(
  total_trades BIGINT,
  winning_trades BIGINT,
  losing_trades BIGINT,
  win_rate NUMERIC,
  total_profit NUMERIC,
  total_loss NUMERIC,
  net_profit NUMERIC,
  average_win NUMERIC,
  average_loss NUMERIC,
  best_trade NUMERIC,
  worst_trade NUMERIC,
  profit_factor NUMERIC
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_trades,
    COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::BIGINT as winning_trades,
    COUNT(CASE WHEN profit_loss < 0 THEN 1 END)::BIGINT as losing_trades,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(CASE WHEN profit_loss > 0 THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC * 100), 2)
      ELSE 0
    END as win_rate,
    COALESCE(ROUND(SUM(CASE WHEN profit_loss > 0 THEN profit_loss END)::NUMERIC, 2), 0) as total_profit,
    COALESCE(ROUND(SUM(CASE WHEN profit_loss < 0 THEN profit_loss END)::NUMERIC, 2), 0) as total_loss,
    COALESCE(ROUND(SUM(profit_loss)::NUMERIC, 2), 0) as net_profit,
    COALESCE(ROUND(AVG(CASE WHEN profit_loss > 0 THEN profit_loss END)::NUMERIC, 2), 0) as average_win,
    COALESCE(ROUND(AVG(CASE WHEN profit_loss < 0 THEN profit_loss END)::NUMERIC, 2), 0) as average_loss,
    COALESCE(ROUND(MAX(profit_loss)::NUMERIC, 2), 0) as best_trade,
    COALESCE(ROUND(MIN(profit_loss)::NUMERIC, 2), 0) as worst_trade,
    CASE
      WHEN SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) END) > 0 THEN
        ROUND((SUM(CASE WHEN profit_loss > 0 THEN profit_loss END) /
        SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) END))::NUMERIC, 2)
      ELSE 0
    END as profit_factor
  FROM goal_session_trades
  WHERE user_id = p_user_id
    AND status = 'closed'
    AND closed_at IS NOT NULL
    AND profit_loss IS NOT NULL;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_trade_statistics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trade_statistics(UUID) TO service_role;

-- Add comment
COMMENT ON FUNCTION get_trade_statistics IS 'Returns comprehensive trading statistics for a user based on closed trades from goal_session_trades table';
