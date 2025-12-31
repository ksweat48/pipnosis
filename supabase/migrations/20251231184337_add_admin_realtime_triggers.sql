/*
  # Add Real-Time Triggers for Admin Dashboard

  ## Purpose
  Enable real-time subscriptions for admin dashboard KPIs by notifying
  Supabase Realtime about changes to critical tables.

  ## Changes
  1. Enable Realtime on admin-relevant tables
  2. Create notification function for admin data changes
  3. Add triggers to notify on data changes
  4. Ensure admin dashboard always has fresh data

  ## Tables Monitored
  - user_profiles (balance, admin status)
  - goal_sessions (session status, scanning)
  - goal_session_trades (trades, P&L)
  - user_token_balance (credit balance)
  - realtime_prices (already enabled)

  ## Security
  - Read-only notifications
  - No data modification
  - Admin-only access enforced at RLS level
*/

-- ============================================================================
-- Enable Realtime on Tables
-- ============================================================================

-- Note: These may already be enabled, will silently succeed if so
DO $$
BEGIN
  -- Enable realtime for user_profiles
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_profiles;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already enabled
  END;

  -- Enable realtime for goal_sessions
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE goal_sessions;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already enabled
  END;

  -- Enable realtime for goal_session_trades
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE goal_session_trades;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already enabled
  END;

  -- Enable realtime for user_token_balance
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_token_balance;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already enabled
  END;

  -- Enable realtime for realtime_prices (should already be enabled)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE realtime_prices;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already enabled
  END;
END $$;

-- ============================================================================
-- Create Notification Function for Admin Dashboard
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_admin_dashboard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Notify via pg_notify for additional coordination
  -- Channel: admin_dashboard_update
  -- Payload: table name and operation type
  PERFORM pg_notify(
    'admin_dashboard_update',
    json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'timestamp', NOW()
    )::text
  );

  -- Return appropriate value based on operation
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- ============================================================================
-- Create Triggers for Admin-Relevant Tables
-- ============================================================================

-- Trigger on user_profiles (balance changes, admin status)
DROP TRIGGER IF EXISTS trigger_admin_user_profiles_update ON user_profiles;
CREATE TRIGGER trigger_admin_user_profiles_update
  AFTER INSERT OR UPDATE OF account_balance, is_admin
  ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_dashboard_update();

-- Trigger on goal_sessions (status changes, scanning)
DROP TRIGGER IF EXISTS trigger_admin_goal_sessions_update ON goal_sessions;
CREATE TRIGGER trigger_admin_goal_sessions_update
  AFTER INSERT OR UPDATE OF status, risk_mode
  ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_dashboard_update();

-- Trigger on goal_session_trades (new trades, status changes, P&L)
DROP TRIGGER IF EXISTS trigger_admin_goal_trades_update ON goal_session_trades;
CREATE TRIGGER trigger_admin_goal_trades_update
  AFTER INSERT OR UPDATE OF status, profit_loss
  ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_dashboard_update();

-- Trigger on goal_session_trades DELETE (trade removal)
DROP TRIGGER IF EXISTS trigger_admin_goal_trades_delete ON goal_session_trades;
CREATE TRIGGER trigger_admin_goal_trades_delete
  AFTER DELETE
  ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_dashboard_update();

-- Trigger on user_token_balance (credit changes)
DROP TRIGGER IF EXISTS trigger_admin_token_balance_update ON user_token_balance;
CREATE TRIGGER trigger_admin_token_balance_update
  AFTER INSERT OR UPDATE OF balance
  ON user_token_balance
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_dashboard_update();

-- ============================================================================
-- Create Admin Dashboard Health Check Function
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_dashboard_health_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_health jsonb;
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

  -- Return health metrics
  SELECT jsonb_build_object(
    'timestamp', NOW(),
    'status', 'healthy',
    'tables', jsonb_build_object(
      'user_profiles', (SELECT COUNT(*) FROM user_profiles),
      'goal_sessions', (SELECT COUNT(*) FROM goal_sessions WHERE status IN ('scanning', 'awaiting_response')),
      'active_trades', (SELECT COUNT(*) FROM goal_session_trades WHERE status = 'open'),
      'realtime_prices', (SELECT COUNT(*) FROM realtime_prices WHERE created_at > NOW() - INTERVAL '5 minutes')
    ),
    'triggers', jsonb_build_object(
      'user_profiles', EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_admin_user_profiles_update'),
      'goal_sessions', EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_admin_goal_sessions_update'),
      'goal_trades', EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_admin_goal_trades_update'),
      'user_token_balance', EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_admin_token_balance_update')
    )
  ) INTO v_health;

  RETURN v_health;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION admin_dashboard_health_check() TO authenticated;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║       ADMIN REALTIME TRIGGERS CREATED                         ║';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'Real-time updates enabled for:';
  RAISE NOTICE '  ✓ user_profiles (balance, admin status)';
  RAISE NOTICE '  ✓ goal_sessions (status, scanning, risk mode)';
  RAISE NOTICE '  ✓ goal_session_trades (trades, P&L, status)';
  RAISE NOTICE '  ✓ user_token_balance (credit balance)';
  RAISE NOTICE '  ✓ realtime_prices (price updates)';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin dashboard will now receive:';
  RAISE NOTICE '  - Instant notifications on data changes';
  RAISE NOTICE '  - Real-time KPI updates';
  RAISE NOTICE '  - Live trade P&L updates';
  RAISE NOTICE '  - Scanning status changes';
  RAISE NOTICE '';
  RAISE NOTICE 'Health check available:';
  RAISE NOTICE '  - Call admin_dashboard_health_check() to verify system';
  RAISE NOTICE '';
END $$;
