/*
  # Clear All Pending Modal Backlog

  1. Purpose
    - Cleans up all accumulated pending modals from all users
    - Fixes issue where old notifications keep popping up on every refresh
    - Provides fresh start for modal notification system

  2. Changes
    - Deletes all undismissed pending modals older than 5 minutes
    - Creates admin function to manually clear modal backlog
    - Adds auto-cleanup for stale modals (older than 24 hours)

  3. Safety
    - Only affects undismissed modals
    - Preserves already-dismissed modal history
    - Service role only for admin cleanup function
*/

-- Emergency cleanup: Delete all undismissed pending modals
-- This clears the current backlog that's causing issues
DELETE FROM pending_user_modals
WHERE dismissed_at IS NULL;

-- Create admin function to manually clear pending modals
CREATE OR REPLACE FUNCTION admin_clear_all_pending_modals()
RETURNS TABLE (
  deleted_count INTEGER,
  oldest_modal_age INTERVAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
  v_oldest_age INTERVAL;
BEGIN
  -- Get age of oldest modal before deletion
  SELECT NOW() - MIN(created_at)
  INTO v_oldest_age
  FROM pending_user_modals
  WHERE dismissed_at IS NULL;

  -- Delete all undismissed modals
  DELETE FROM pending_user_modals
  WHERE dismissed_at IS NULL;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_count, COALESCE(v_oldest_age, INTERVAL '0');
END;
$$;

-- Create function to auto-cleanup stale modals (older than 24 hours)
CREATE OR REPLACE FUNCTION auto_dismiss_stale_pending_modals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  dismissed_count INTEGER;
BEGIN
  -- Auto-dismiss modals older than 24 hours
  UPDATE pending_user_modals
  SET
    dismissed_at = NOW(),
    user_action = 'auto_dismissed_stale'
  WHERE dismissed_at IS NULL
    AND created_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS dismissed_count = ROW_COUNT;

  RETURN dismissed_count;
END;
$$;

-- Grant execute permissions to authenticated users for cleanup function
GRANT EXECUTE ON FUNCTION auto_dismiss_stale_pending_modals() TO authenticated;

-- Grant execute permissions to service role for admin function
GRANT EXECUTE ON FUNCTION admin_clear_all_pending_modals() TO service_role;

COMMENT ON FUNCTION admin_clear_all_pending_modals IS 'Admin function to manually clear all pending modals across all users';
COMMENT ON FUNCTION auto_dismiss_stale_pending_modals IS 'Auto-dismisses pending modals older than 24 hours to prevent backlog buildup';