/*
  # Enable RLS on Goal Sessions and Trades Tables

  ## Critical Security Issue
  The `goal_sessions` and `goal_session_trades` tables do NOT have Row Level Security enabled.
  This allows ANY authenticated user to query ANY user's trades and sessions, causing:

  1. **Privacy Violation**: Users can see other users' trading data
  2. **Chart Bug**: TradePage shows trade lines from OTHER users' open positions
  3. **Data Leakage**: Sensitive trading information (entry, SL, TP) exposed cross-user

  ## Root Cause
  These tables were created without `ENABLE ROW LEVEL SECURITY` and without user-scoped policies.
  When TradePage.tsx queries for open trades by symbol, it returns ANY user's trades, not just
  the current user's trades.

  ## Solution
  1. Enable RLS on both `goal_sessions` and `goal_session_trades`
  2. Create user-scoped policies: users can only access their own data
  3. NO admin RLS policies (to avoid infinite recursion from migration 20260101004209)
  4. Admin access continues via existing SECURITY DEFINER functions

  ## Security Model
  - Regular users: Can only SELECT/INSERT/UPDATE their own rows (WHERE user_id = auth.uid())
  - Admin users: Access all data via SECURITY DEFINER functions that bypass RLS:
    - admin_get_all_users()
    - admin_get_user_details()
    - admin_get_all_trades_for_user()
    - etc.

  ## Changes
  1. Enable RLS on goal_sessions
  2. Enable RLS on goal_session_trades
  3. Create SELECT policy for users on goal_sessions
  4. Create INSERT policy for users on goal_sessions
  5. Create UPDATE policy for users on goal_sessions
  6. Create SELECT policy for users on goal_session_trades
  7. Create INSERT policy for users on goal_session_trades
  8. Create UPDATE policy for users on goal_session_trades
*/

-- ============================================================================
-- STEP 1: Enable RLS on goal_sessions
-- ============================================================================

DO $$
BEGIN
  -- Check if RLS is already enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'goal_sessions'
    AND rowsecurity = true
  ) THEN
    ALTER TABLE goal_sessions ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE '✓ Enabled RLS on goal_sessions';
  ELSE
    RAISE NOTICE '✓ RLS already enabled on goal_sessions';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Enable RLS on goal_session_trades
-- ============================================================================

DO $$
BEGIN
  -- Check if RLS is already enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'goal_session_trades'
    AND rowsecurity = true
  ) THEN
    ALTER TABLE goal_session_trades ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE '✓ Enabled RLS on goal_session_trades';
  ELSE
    RAISE NOTICE '✓ RLS already enabled on goal_session_trades';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Create User-Scoped Policies for goal_sessions
-- ============================================================================

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view own goal sessions" ON goal_sessions;
DROP POLICY IF EXISTS "Users can insert own goal sessions" ON goal_sessions;
DROP POLICY IF EXISTS "Users can update own goal sessions" ON goal_sessions;

-- SELECT: Users can only view their own sessions
CREATE POLICY "Users can view own goal sessions"
  ON goal_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: Users can only create sessions for themselves
CREATE POLICY "Users can insert own goal sessions"
  ON goal_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own sessions
CREATE POLICY "Users can update own goal sessions"
  ON goal_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- STEP 4: Create User-Scoped Policies for goal_session_trades
-- ============================================================================

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view own goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Users can insert own goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Users can update own goal session trades" ON goal_session_trades;

-- SELECT: Users can only view their own trades
CREATE POLICY "Users can view own goal session trades"
  ON goal_session_trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: Users can only create trades for themselves
CREATE POLICY "Users can insert own goal session trades"
  ON goal_session_trades FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own trades
CREATE POLICY "Users can update own goal session trades"
  ON goal_session_trades FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- STEP 5: Verify Policies Are Active
-- ============================================================================

DO $$
DECLARE
  v_sessions_policies INTEGER;
  v_trades_policies INTEGER;
BEGIN
  -- Count policies on goal_sessions
  SELECT COUNT(*) INTO v_sessions_policies
  FROM pg_policies
  WHERE tablename = 'goal_sessions';

  -- Count policies on goal_session_trades
  SELECT COUNT(*) INTO v_trades_policies
  FROM pg_policies
  WHERE tablename = 'goal_session_trades';

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '         RLS ENABLED ON GOAL SESSIONS AND TRADES TABLES           ';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✓ goal_sessions: % policies active', v_sessions_policies;
  RAISE NOTICE '✓ goal_session_trades: % policies active', v_trades_policies;
  RAISE NOTICE '';
  RAISE NOTICE 'Security Model:';
  RAISE NOTICE '  - Users can only access their own sessions and trades';
  RAISE NOTICE '  - user_id filter enforced at database level';
  RAISE NOTICE '  - Admin access via SECURITY DEFINER functions only';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed Issues:';
  RAISE NOTICE '  ✓ Users can no longer see other users'' trade data';
  RAISE NOTICE '  ✓ Chart lines will only show current user''s positions';
  RAISE NOTICE '  ✓ Privacy and data isolation enforced';
  RAISE NOTICE '';
  RAISE NOTICE 'Note: Admin dashboard uses SECURITY DEFINER functions to bypass RLS';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
