/*
  # Add Platform P&L to Admin KPIs

  ## Changes

  1. Update `admin_get_platform_kpis` function
     - Add `total_platform_pnl` - Sum of all user P&L (account_balance - initial_balance)
     - Add `total_platform_balance` - Sum of all user account balances
     - Add `open_positions_count` - Count of open positions across all users
     - Add `total_unrealized_pnl` - Sum of unrealized P&L from open trades

  ## Security
  - Maintains existing admin-only access control
  - Read-only operation, no data modification
*/

-- Drop existing function to recreate with P&L fields
DROP FUNCTION IF EXISTS admin_get_platform_kpis();

-- Recreate admin_get_platform_kpis with P&L fields
CREATE OR REPLACE FUNCTION admin_get_platform_kpis()
RETURNS TABLE (
  total_users bigint,
  active_users bigint,
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  overall_win_rate numeric,
  total_platform_pnl numeric,
  total_platform_balance numeric,
  open_positions_count bigint,
  total_unrealized_pnl numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  -- Get the calling user's ID
  calling_user_id := auth.uid();

  -- Security check: Only admins can access this function
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id
    AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    -- Total registered users
    (SELECT COUNT(*)::bigint FROM user_profiles) as total_users,

    -- Active users (with trades in last 7 days)
    (
      SELECT COUNT(DISTINCT user_id)::bigint
      FROM goal_session_trades
      WHERE created_at >= NOW() - INTERVAL '7 days'
    ) as active_users,

    -- Total closed trades across platform
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'closed'
    ) as total_trades,

    -- Winning trades (PnL > 0)
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'closed' AND profit_loss > 0
    ) as winning_trades,

    -- Losing trades (PnL <= 0)
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'closed' AND profit_loss <= 0
    ) as losing_trades,

    -- Overall win rate percentage
    (
      SELECT
        CASE
          WHEN COUNT(*) > 0 THEN
            ROUND((COUNT(*) FILTER (WHERE profit_loss > 0)::numeric / COUNT(*)::numeric) * 100, 2)
          ELSE 0
        END
      FROM goal_session_trades
      WHERE status = 'closed'
    ) as overall_win_rate,

    -- Total Platform P&L (sum of all closed trades profit_loss)
    (
      SELECT COALESCE(SUM(profit_loss), 0)
      FROM goal_session_trades
      WHERE status = 'closed'
    ) as total_platform_pnl,

    -- Total Platform Balance (sum of all user account balances)
    (
      SELECT COALESCE(SUM(account_balance), 0)
      FROM user_profiles
    ) as total_platform_balance,

    -- Open positions count
    (
      SELECT COUNT(*)::bigint
      FROM goal_session_trades
      WHERE status = 'open'
    ) as open_positions_count,

    -- Total unrealized P&L (sum of all open trades)
    (
      SELECT COALESCE(SUM(unrealized_pnl), 0)
      FROM goal_session_trades
      WHERE status = 'open'
    ) as total_unrealized_pnl;
END;
$$;

-- Grant execute permissions to authenticated users (admin check is inside function)
GRANT EXECUTE ON FUNCTION admin_get_platform_kpis() TO authenticated;
