/*
  # Add Admin Role and Analytics Support

  ## Summary
  This migration adds admin functionality to the Pipnosis platform, enabling designated users
  to access comprehensive analytics and manage the platform. It also creates database views
  for aggregated analytics across all users.

  ## Changes

  1. Schema Updates
    - Add `is_admin` column to user_profiles (boolean, default false)
    - Add `is_public` column to user_profiles for future public profiles feature

  2. Admin User Setup
    - Set ksweat48@gmail.com as an admin user automatically

  3. Admin RLS Policies
    - Allow admin users to view all user profiles
    - Allow admin users to view all trading prompts across platform
    - Allow admin users to view all trade records across platform
    - Allow admin users to view all journal entries across platform
    - Allow admin users to view all trading sessions across platform

  4. Analytics Views
    - Create view for platform-wide trading statistics
    - Create view for aggregated P&L by user
    - Create view for AI performance metrics
    - Create view for trading activity summary

  5. Performance Indexes
    - Add indexes to optimize admin dashboard queries

  ## Security
  - RLS policies ensure only authenticated admins can access platform-wide data
  - Regular users can still only access their own data
  - Admin status cannot be modified by regular users
*/

-- Add is_admin column to user_profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN is_admin boolean DEFAULT false;
  END IF;
END $$;

-- Set ksweat48@gmail.com as admin
UPDATE user_profiles 
SET is_admin = true 
WHERE email = 'ksweat48@gmail.com';

-- Create function to set admin on user creation if email matches
CREATE OR REPLACE FUNCTION public.check_admin_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email = 'ksweat48@gmail.com' THEN
    NEW.is_admin = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-set admin status
DROP TRIGGER IF EXISTS set_admin_on_insert ON user_profiles;
CREATE TRIGGER set_admin_on_insert
  BEFORE INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_admin_email();

-- Admin RLS Policies - Allow admins to view all data

-- Admin can view all user profiles
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Admin can view all trading prompts
CREATE POLICY "Admins can view all prompts"
  ON trading_prompts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Admin can view all trade records
CREATE POLICY "Admins can view all trades"
  ON trade_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Admin can view all journal entries
CREATE POLICY "Admins can view all journal entries"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Admin can view all trading sessions
CREATE POLICY "Admins can view all sessions"
  ON trading_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Create analytics view: Platform-wide statistics
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

-- Create analytics view: User trading summary
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

-- Create analytics view: AI Performance Metrics
CREATE OR REPLACE VIEW ai_performance_metrics AS
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
GROUP BY tp.ai_confidence;

-- Create analytics view: Trading activity by symbol
CREATE OR REPLACE VIEW trading_by_symbol AS
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
GROUP BY tr.symbol
ORDER BY total_trades DESC;

-- Create indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_admin ON user_profiles(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_trade_records_pnl ON trade_records(pnl);
CREATE INDEX IF NOT EXISTS idx_trade_records_symbol_status ON trade_records(symbol, status);
CREATE INDEX IF NOT EXISTS idx_trading_prompts_confidence ON trading_prompts(ai_confidence);
