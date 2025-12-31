/*
  # Add Admin RLS Policies for Real-Time Updates

  ## Problem
  The admin dashboard has real-time subscriptions set up correctly, but Supabase
  Realtime respects Row Level Security (RLS). Current policies only allow users
  to view their own data, so admins don't receive real-time events for other
  users' changes.

  ## Solution
  Add SELECT policies that allow admin users (is_admin = true) to view all rows
  in the tables monitored for real-time updates.

  ## Changes
  1. Add admin SELECT policy for goal_sessions
  2. Add admin SELECT policy for goal_session_trades
  3. Add admin SELECT policy for user_profiles
  4. Add admin SELECT policy for user_token_balance
  5. Add admin SELECT policy for realtime_prices

  ## Security
  - Only users with is_admin = true can access all rows
  - Regular users still restricted to their own data
  - Admin check performed via subquery on user_profiles table
*/

-- ============================================================================
-- Admin SELECT Policy for goal_sessions
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_sessions'
    AND policyname = 'Admins can view all goal sessions'
  ) THEN
    CREATE POLICY "Admins can view all goal sessions"
      ON goal_sessions FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
    RAISE NOTICE 'Created policy: Admins can view all goal sessions';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all goal sessions';
  END IF;
END $$;

-- ============================================================================
-- Admin SELECT Policy for goal_session_trades
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_session_trades'
    AND policyname = 'Admins can view all goal session trades'
  ) THEN
    CREATE POLICY "Admins can view all goal session trades"
      ON goal_session_trades FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
    RAISE NOTICE 'Created policy: Admins can view all goal session trades';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all goal session trades';
  END IF;
END $$;

-- ============================================================================
-- Admin SELECT Policy for user_profiles
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_profiles'
    AND policyname = 'Admins can view all user profiles'
  ) THEN
    CREATE POLICY "Admins can view all user profiles"
      ON user_profiles FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up_check
          WHERE up_check.id = auth.uid()
          AND up_check.is_admin = true
        )
      );
    RAISE NOTICE 'Created policy: Admins can view all user profiles';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all user profiles';
  END IF;
END $$;

-- ============================================================================
-- Admin SELECT Policy for user_token_balance
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_token_balance'
    AND policyname = 'Admins can view all token balances'
  ) THEN
    CREATE POLICY "Admins can view all token balances"
      ON user_token_balance FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
    RAISE NOTICE 'Created policy: Admins can view all token balances';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all token balances';
  END IF;
END $$;

-- ============================================================================
-- Admin SELECT Policy for realtime_prices
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'realtime_prices'
    AND policyname = 'Admins can view all realtime prices'
  ) THEN
    CREATE POLICY "Admins can view all realtime prices"
      ON realtime_prices FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
          AND user_profiles.is_admin = true
        )
      );
    RAISE NOTICE 'Created policy: Admins can view all realtime prices';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all realtime prices';
  END IF;
END $$;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '       ADMIN RLS POLICIES FOR REAL-TIME UPDATES CREATED           ';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Admin users can now receive real-time updates for:';
  RAISE NOTICE '  - goal_sessions (scanning status, session changes)';
  RAISE NOTICE '  - goal_session_trades (trade opens/closes, P&L updates)';
  RAISE NOTICE '  - user_profiles (balance changes, admin status)';
  RAISE NOTICE '  - user_token_balance (credit balance changes)';
  RAISE NOTICE '  - realtime_prices (live price updates for P&L calc)';
  RAISE NOTICE '';
  RAISE NOTICE 'The admin dashboard should now update automatically when:';
  RAISE NOTICE '  - Users start/stop scanning';
  RAISE NOTICE '  - Trades are opened or closed';
  RAISE NOTICE '  - Balances change';
  RAISE NOTICE '  - Credits are added';
  RAISE NOTICE '';
END $$;
