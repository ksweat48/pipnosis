/*
  ═══════════════════════════════════════════════════════════════════════════
  CREATE SYSTEM NOTIFICATION RPC - SSOT & CCIP Compliance
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  - Admin dashboard triggers RLS violations when diagnostic services create notifications
  - SLTP diagnostic service fails with 403 Forbidden when creating alerts for users
  - Current RLS policy requires auth.uid() = user_id, which fails when:
    * Admin views dashboard
    * System creates notification for User A
    * auth.uid() = Admin's ID, but user_id = User A
    * RLS blocks the insert

  ## Root Cause
  - System services need to create notifications on behalf of users
  - Direct INSERT requires authenticated user to match target user_id
  - No bypass mechanism for legitimate system notifications

  ## Solution
  Create `create_system_notification()` RPC function with SECURITY DEFINER to:
  1. Bypass RLS for system-generated notifications
  2. Validate notification types (only system alerts allowed)
  3. Maintain audit trail
  4. Prevent abuse through type restrictions

  ## SSOT Compliance
  - notification-coordinator.ts remains SSOT for ALL notification creation
  - Adds new `sendSystemNotification()` method that calls this RPC
  - Direct INSERT still subject to RLS for user-initiated notifications
  - No changes to existing notification flows

  ## Security
  - Only allows specific system notification types
  - Validates all required fields
  - Maintains data isolation (can't read other users' data)
  - Audit logging for system notification creation
  - Rate limiting handled by notification-coordinator

  ## Authorized System Notification Types
  - system_alert: Critical system alerts (stale data, monitoring issues)
  - wellness_check: Periodic wellness checks
  - mid_trade_alert: Mid-trade evaluations
  - balance_update: System balance corrections

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Create the system notification function
CREATE OR REPLACE FUNCTION create_system_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_priority text DEFAULT 'medium',
  p_trade_id uuid DEFAULT NULL,
  p_goal_session_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id uuid;
  v_allowed_types text[] := ARRAY[
    'system_alert',
    'wellness_check',
    'mid_trade_alert',
    'balance_update'
  ];
BEGIN
  -- Validate notification type (only allow system types)
  IF p_type != ALL(v_allowed_types) THEN
    RAISE EXCEPTION 'Invalid system notification type: %. Allowed types: %',
      p_type, array_to_string(v_allowed_types, ', ');
  END IF;

  -- Validate required fields
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_title IS NULL OR p_title = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;

  IF p_message IS NULL OR p_message = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;

  -- Validate priority
  IF p_priority NOT IN ('low', 'medium', 'high', 'critical') THEN
    RAISE EXCEPTION 'Invalid priority: %. Must be one of: low, medium, high, critical', p_priority;
  END IF;

  -- Insert notification (bypasses RLS via SECURITY DEFINER)
  INSERT INTO goal_notifications (
    user_id,
    type,
    title,
    message,
    metadata,
    priority,
    trade_id,
    goal_session_id,
    read,
    created_at
  )
  VALUES (
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_metadata,
    p_priority,
    p_trade_id,
    p_goal_session_id,
    false,
    now()
  )
  RETURNING id INTO v_notification_id;

  -- Log system notification creation for audit
  RAISE LOG 'System notification created: id=%, type=%, user_id=%, priority=%',
    v_notification_id, p_type, p_user_id, p_priority;

  RETURN v_notification_id;
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION create_system_notification TO authenticated, service_role;

-- Add comment for documentation
COMMENT ON FUNCTION create_system_notification IS
'Creates system notifications bypassing RLS. Only allows specific system notification types. Used by diagnostic services, monitoring systems, and admin operations. SSOT: notification-coordinator.ts';

-- Verification
DO $$
DECLARE
  v_function_exists boolean;
BEGIN
  -- Check if function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_system_notification'
  ) INTO v_function_exists;

  IF v_function_exists THEN
    RAISE NOTICE '✅ create_system_notification() function created successfully';
    RAISE NOTICE '✅ SECURITY DEFINER bypasses RLS for system notifications';
    RAISE NOTICE '✅ Only allows system alert types (system_alert, wellness_check, mid_trade_alert, balance_update)';
    RAISE NOTICE '✅ Validates all required fields';
    RAISE NOTICE '✅ Maintains audit trail via LOG statements';
    RAISE NOTICE '✅ notification-coordinator.ts SSOT will use this via RPC';
  ELSE
    RAISE EXCEPTION 'Failed to create create_system_notification() function';
  END IF;
END $$;
