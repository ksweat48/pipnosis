/*
  # Consolidate Balance Fields and Fix Trade Statistics

  1. Changes to user_profiles
    - Copy any demo_balance values to account_balance (preserve data)
    - Drop demo_balance column (consolidate to single balance field)

  2. Update get_trade_statistics function
    - Include trades from BOTH trade_history and goal_session_trades
    - Calculate accurate statistics across all trade sources
    - Return complete trading performance data

  3. Purpose
    - Eliminate confusion between demo_balance and account_balance
    - Show accurate trade counts and statistics including goal mode trades
    - Fix UI showing 0 trades when goal trades exist
*/

-- ============================================================================
-- STEP 1: Consolidate balance fields
-- ============================================================================

-- Copy demo_balance to account_balance if demo_balance is higher (preserve user data)
UPDATE user_profiles
SET account_balance = GREATEST(COALESCE(account_balance, 10000), COALESCE(demo_balance, 10000))
WHERE demo_balance IS NOT NULL AND demo_balance > account_balance;

-- Drop demo_balance column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'demo_balance'
  ) THEN
    ALTER TABLE user_profiles DROP COLUMN demo_balance;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Update get_trade_statistics to include ALL trades
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

    -- Trades from goal_session_trades (goal mode trades)
    SELECT
      realized_pnl as profit_loss,
      opened_at,
      closed_at
    FROM goal_session_trades
    WHERE user_id = p_user_id
    AND status = 'closed'
    AND closed_at IS NOT NULL
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