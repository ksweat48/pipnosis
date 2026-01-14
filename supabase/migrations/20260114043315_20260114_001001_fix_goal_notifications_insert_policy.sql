/*
  ═══════════════════════════════════════════════════════════════════════════
  FIX: goal_notifications RLS INSERT Policy - CCIP Compliance
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  goal_notifications table has RLS enabled but NO INSERT policy, causing:
  - 403 Forbidden errors when creating notifications
  - Diagnostic system cannot create stale data alerts
  - notification-coordinator.ts fails silently
  - System notifications blocked

  ## Root Cause
  Table was created with SELECT/UPDATE policies but INSERT was missing.
  Code assumes INSERT capability via notification-coordinator.ts (SSOT).

  ## Solution
  Add missing INSERT policies to allow:
  1. Authenticated users to insert own notifications (user_id = auth.uid())
  2. Service role to insert all notifications (system alerts, diagnostics)

  ## SSOT Compliance
  - notification-coordinator.ts remains SSOT for notification creation
  - RLS enforces user_id ownership at database level
  - No changes to table structure
  - No changes to existing policies
  - Only adds missing INSERT capability

  ## Security
  - Users can only insert notifications for themselves
  - Service role can insert system-wide notifications
  - Maintains data isolation between users

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Drop existing INSERT policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can insert own notifications" ON goal_notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON goal_notifications;
DROP POLICY IF EXISTS "Authenticated users can insert own notifications" ON goal_notifications;

-- Create INSERT policy for authenticated users (own notifications only)
CREATE POLICY "Authenticated users can insert own notifications"
  ON goal_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create INSERT policy for service role (all notifications)
CREATE POLICY "Service role can insert notifications"
  ON goal_notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Verification
DO $$
DECLARE
  user_insert_policy_exists boolean;
  service_insert_policy_exists boolean;
  rls_enabled boolean;
BEGIN
  -- Check if RLS is enabled
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE relname = 'goal_notifications' AND relnamespace = 'public'::regnamespace;

  -- Check if user INSERT policy exists
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_notifications'
      AND policyname = 'Authenticated users can insert own notifications'
      AND cmd = 'INSERT'
  ) INTO user_insert_policy_exists;

  -- Check if service role INSERT policy exists
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'goal_notifications'
      AND policyname = 'Service role can insert notifications'
      AND cmd = 'INSERT'
  ) INTO service_insert_policy_exists;

  -- Validate
  IF rls_enabled AND user_insert_policy_exists AND service_insert_policy_exists THEN
    RAISE NOTICE '✅ goal_notifications INSERT policies created successfully';
    RAISE NOTICE '✅ RLS is enabled on goal_notifications';
    RAISE NOTICE '✅ Users can insert own notifications';
    RAISE NOTICE '✅ Service role can insert all notifications';
    RAISE NOTICE '✅ Diagnostic alerts will now work';
    RAISE NOTICE '✅ notification-coordinator.ts SSOT is now functional';
  ELSE
    RAISE EXCEPTION 'Failed to create INSERT policies for goal_notifications';
  END IF;
END $$;
