/*
  # Fix Goal Sessions RLS for SECURITY DEFINER Functions

  ## Problem
  The `can_scan_now` RPC function is failing with 400 errors for regular users because:
  - The function is marked as SECURITY DEFINER
  - But RLS policies on goal_sessions prevent the service role from accessing sessions
  - This blocks all non-admin users from scanning for trades

  ## Solution
  Add policies that allow SECURITY DEFINER functions (service_role context) to access
  goal_sessions table for read operations.

  ## Changes
  1. Add service_role SELECT policy for goal_sessions
  2. Add service_role UPDATE policy for goal_sessions (needed by scanning functions)
  3. Ensure all related scanning functions can operate correctly

  ## Security
  - Regular users still restricted by existing RLS policies
  - Service role only gets access when called through SECURITY DEFINER functions
  - Admin privileges remain unchanged
*/

-- ============================================================================
-- Add service role policies for goal_sessions
-- ============================================================================

CREATE POLICY "Service role can read all goal sessions"
  ON goal_sessions FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can update all goal sessions"
  ON goal_sessions FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Add service role policies for goal_session_trades
-- ============================================================================

CREATE POLICY "Service role can read all goal session trades"
  ON goal_session_trades FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert goal session trades"
  ON goal_session_trades FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update goal session trades"
  ON goal_session_trades FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Add service role policies for goal_ai_conversations
-- ============================================================================

CREATE POLICY "Service role can insert conversations"
  ON goal_ai_conversations FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can read conversations"
  ON goal_ai_conversations FOR SELECT
  TO service_role
  USING (true);

-- ============================================================================
-- Add service role policies for goal_forecasts
-- ============================================================================

CREATE POLICY "Service role can insert forecasts"
  ON goal_forecasts FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update forecasts"
  ON goal_forecasts FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Add service role policies for goal_progress_snapshots
-- ============================================================================

CREATE POLICY "Service role can insert progress snapshots"
  ON goal_progress_snapshots FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================================
-- Add service role policies for goal_notifications
-- ============================================================================

CREATE POLICY "Service role can insert notifications"
  ON goal_notifications FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update notifications"
  ON goal_notifications FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY "Service role can read all goal sessions" ON goal_sessions IS
  'Allows SECURITY DEFINER functions to access goal sessions for all users';

COMMENT ON POLICY "Service role can update all goal sessions" ON goal_sessions IS
  'Allows scanning functions to update session state, counters, and timestamps';