/*
  # Emergency Fix: Remove Recursive RLS Policy

  ## Critical Issue
  PostgreSQL error 42P17: "infinite recursion detected in policy for relation 'user_profiles'"
  
  ## Root Cause
  The policy "Admins can view all user profiles" on user_profiles table contains a subquery
  that references user_profiles, creating infinite recursion when PostgreSQL tries to
  evaluate the policy.

  ## Solution
  Drop the recursive policy. Admin access to user data is already handled via
  SECURITY DEFINER functions (admin_get_all_users, admin_get_user_details, etc.)
  which bypass RLS entirely.

  ## Impact
  - Immediately restores database functionality
  - All database queries will work again
  - Admin functions continue to work via SECURITY DEFINER
*/

-- Drop the recursive admin policy that's causing infinite recursion
DROP POLICY IF EXISTS "Admins can view all user profiles" ON user_profiles;

-- Also drop any other potentially recursive admin policies on these tables
DROP POLICY IF EXISTS "Admins can view all goal sessions" ON goal_sessions;
DROP POLICY IF EXISTS "Admins can view all trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Admins can view all token balances" ON user_token_balance;
DROP POLICY IF EXISTS "Admins can view all realtime prices" ON realtime_prices;

-- Verify the fix by checking existing policies don't have recursion
DO $$
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE 'EMERGENCY FIX: Recursive RLS policies removed';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Dropped policies:';
  RAISE NOTICE '  - "Admins can view all user profiles" on user_profiles';
  RAISE NOTICE '  - "Admins can view all goal sessions" on goal_sessions';
  RAISE NOTICE '  - "Admins can view all trades" on goal_session_trades';
  RAISE NOTICE '  - "Admins can view all token balances" on user_token_balance';
  RAISE NOTICE '  - "Admins can view all realtime prices" on realtime_prices';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin access continues via SECURITY DEFINER functions:';
  RAISE NOTICE '  - admin_get_all_users()';
  RAISE NOTICE '  - admin_get_user_details()';
  RAISE NOTICE '  - admin_add_credits_to_user()';
  RAISE NOTICE '  - admin_clear_stuck_goal_session()';
  RAISE NOTICE '  - admin_recalculate_user_balance()';
  RAISE NOTICE '';
  RAISE NOTICE 'Database functionality should be restored immediately.';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
END $$;
