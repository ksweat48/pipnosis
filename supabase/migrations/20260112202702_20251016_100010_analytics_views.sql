/*
  # Analytics Views & Waitlist

  1. Tables
    - waitlist

  2. Views
    - platform_statistics (admin dashboard)
    - user_trading_summary (admin dashboard)

  3. Indexes
    - Waitlist indexes
*/

-- Waitlist Table
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta')),
  referral_code text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Waitlist Indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

-- Platform-wide statistics view
CREATE OR REPLACE VIEW platform_statistics AS
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
LEFT JOIN trade_records tr ON tr.user_id = up.id;

-- User trading summary view
CREATE OR REPLACE VIEW user_trading_summary AS
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
GROUP BY up.id, up.email, up.full_name, up.account_balance, up.plan_type, up.created_at;

-- Completion message
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '🎉 PIPNOSIS DATABASE MIGRATION COMPLETED SUCCESSFULLY! 🎉';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'All 10 migration files have been applied successfully.';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Go to Table Editor > user_profiles in Supabase Dashboard';
  RAISE NOTICE '2. Find your user record by email';
  RAISE NOTICE '3. Set is_admin = true for your account';
  RAISE NOTICE '4. Refresh your Pipnosis application';
  RAISE NOTICE '5. The Auto Trading button should now work!';
  RAISE NOTICE '';
  RAISE NOTICE 'Your database is ready for Pipnosis AI Trading Platform.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;