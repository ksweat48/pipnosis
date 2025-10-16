/*
  # Fix Analytics Views Security

  ## Summary
  This migration fixes the 500 Internal Server Error on analytics views by adding
  proper security through security barrier views and conditional logic.

  ## Problem
  PostgreSQL views don't support RLS policies directly. The analytics views need to
  filter results based on whether the user is an admin, returning data only for
  admin users and nothing for regular users.

  ## Solution
  Recreate all analytics views as SECURITY BARRIER views with built-in admin checks.
  This ensures that:
  1. Only admin users can see the aggregated data
  2. Regular users get empty result sets (no errors)
  3. No infinite recursion occurs
  4. Queries are properly secured at the view level

  ## Changes
  1. Drop and recreate platform_statistics with admin check
  2. Drop and recreate user_trading_summary with admin check
  3. Drop and recreate ai_performance_metrics with admin check
  4. Drop and recreate trading_by_symbol with admin check

  ## Security
  - Views will only return data if is_admin_user(auth.uid()) returns true
  - Regular users see empty results, not errors
  - SECURITY BARRIER ensures proper security isolation
  - No RLS recursion since we check admin status before querying
*/

-- Drop existing views
DROP VIEW IF EXISTS platform_statistics CASCADE;
DROP VIEW IF EXISTS user_trading_summary CASCADE;
DROP VIEW IF EXISTS ai_performance_metrics CASCADE;
DROP VIEW IF EXISTS trading_by_symbol CASCADE;

-- Recreate platform_statistics with admin check
CREATE VIEW platform_statistics WITH (security_barrier = true) AS
SELECT
  COUNT(DISTINCT up.id) as total_users,
  COUNT(DISTINCT CASE WHEN tr.status = 'open' THEN up.id END) as active_traders,
  COUNT(tr.id) as total_trades,
  COUNT(CASE WHEN tr.status = 'open' THEN 1 END) as open_positions,
  COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) as closed_positions,
  COALESCE(SUM(tr.pnl), 0) as total_platform_pnl,
  COALESCE(AVG(tr.pnl) FILTER (WHERE tr.status = 'closed'), 0) as avg_trade_pnl,
  COALESCE(SUM(up.account_balance), 0) as total_platform_balance,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl < 0 THEN 1 END) as losing_trades,
  CASE 
    WHEN COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) > 0 
    THEN ROUND(
      (COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END)::numeric / 
       COUNT(CASE WHEN tr.status = 'closed' THEN 1 END)::numeric * 100), 2
    )
    ELSE 0 
  END as win_rate_percentage
FROM user_profiles up
LEFT JOIN trade_records tr ON tr.user_id = up.id
WHERE public.is_admin_user(auth.uid());

-- Recreate user_trading_summary with admin check
CREATE VIEW user_trading_summary WITH (security_barrier = true) AS
SELECT
  up.id as user_id,
  up.email,
  up.full_name,
  up.account_balance,
  up.plan_type,
  up.created_at as user_since,
  COUNT(tr.id) as total_trades,
  COUNT(CASE WHEN tr.status = 'open' THEN 1 END) as open_positions,
  COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) as closed_trades,
  COALESCE(SUM(tr.pnl), 0) as total_pnl,
  COALESCE(AVG(tr.pnl) FILTER (WHERE tr.status = 'closed'), 0) as avg_pnl_per_trade,
  COALESCE(MAX(tr.pnl), 0) as best_trade,
  COALESCE(MIN(tr.pnl), 0) as worst_trade,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl < 0 THEN 1 END) as losing_trades,
  CASE 
    WHEN COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) > 0 
    THEN ROUND(
      (COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END)::numeric / 
       COUNT(CASE WHEN tr.status = 'closed' THEN 1 END)::numeric * 100), 2
    )
    ELSE 0 
  END as win_rate
FROM user_profiles up
LEFT JOIN trade_records tr ON tr.user_id = up.id
WHERE public.is_admin_user(auth.uid())
GROUP BY up.id, up.email, up.full_name, up.account_balance, up.plan_type, up.created_at;

-- Recreate ai_performance_metrics with admin check
CREATE VIEW ai_performance_metrics WITH (security_barrier = true) AS
SELECT
  tp.ai_confidence,
  COUNT(tr.id) as trades_executed,
  COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) as completed_trades,
  COALESCE(SUM(tr.pnl), 0) as total_pnl,
  COALESCE(AVG(tr.pnl) FILTER (WHERE tr.status = 'closed'), 0) as avg_pnl,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl < 0 THEN 1 END) as losing_trades,
  CASE 
    WHEN COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) > 0 
    THEN ROUND(
      (COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END)::numeric / 
       COUNT(CASE WHEN tr.status = 'closed' THEN 1 END)::numeric * 100), 2
    )
    ELSE 0 
  END as win_rate
FROM trading_prompts tp
LEFT JOIN trade_records tr ON tr.prompt_id = tp.id
WHERE tp.ai_confidence IS NOT NULL
  AND public.is_admin_user(auth.uid())
GROUP BY tp.ai_confidence;

-- Recreate trading_by_symbol with admin check
CREATE VIEW trading_by_symbol WITH (security_barrier = true) AS
SELECT
  tr.symbol,
  COUNT(tr.id) as total_trades,
  COUNT(CASE WHEN tr.status = 'open' THEN 1 END) as open_positions,
  COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) as closed_trades,
  COALESCE(SUM(tr.pnl), 0) as total_pnl,
  COALESCE(AVG(tr.pnl) FILTER (WHERE tr.status = 'closed'), 0) as avg_pnl,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl < 0 THEN 1 END) as losing_trades,
  CASE 
    WHEN COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) > 0 
    THEN ROUND(
      (COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END)::numeric / 
       COUNT(CASE WHEN tr.status = 'closed' THEN 1 END)::numeric * 100), 2
    )
    ELSE 0 
  END as win_rate
FROM trade_records tr
WHERE public.is_admin_user(auth.uid())
GROUP BY tr.symbol
ORDER BY total_trades DESC;

-- Grant SELECT permissions to authenticated users (views handle security internally)
GRANT SELECT ON platform_statistics TO authenticated;
GRANT SELECT ON user_trading_summary TO authenticated;
GRANT SELECT ON ai_performance_metrics TO authenticated;
GRANT SELECT ON trading_by_symbol TO authenticated;

-- Add helpful comment
COMMENT ON VIEW platform_statistics IS 'Admin-only view: Returns aggregated platform statistics. Empty for non-admin users.';
COMMENT ON VIEW user_trading_summary IS 'Admin-only view: Returns per-user trading summaries. Empty for non-admin users.';
COMMENT ON VIEW ai_performance_metrics IS 'Admin-only view: Returns AI performance metrics by confidence level. Empty for non-admin users.';
COMMENT ON VIEW trading_by_symbol IS 'Admin-only view: Returns trading statistics by symbol. Empty for non-admin users.';

-- Verify the views were created successfully
DO $$
BEGIN
  RAISE NOTICE 'Analytics views recreated with built-in admin security checks.';
  RAISE NOTICE 'Views will only return data for admin users via is_admin_user() function.';
END $$;
