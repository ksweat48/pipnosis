/*
  # Add Auto-Dismiss Function for Stale Modals
  
  1. Purpose
    - Prevent modal notification loops by auto-dismissing old modals
    - Can be called by cron job or manually
    - Protects users from notification spam
  
  2. Function
    - auto_dismiss_stale_modals()
    - Dismisses modals older than 30 minutes that haven't been interacted with
    - Returns count of dismissed modals
  
  3. Security
    - Function runs with SECURITY DEFINER (bypass RLS)
    - Only service role should call this
*/

-- Create function to auto-dismiss stale modals
CREATE OR REPLACE FUNCTION auto_dismiss_stale_modals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  dismissed_count INTEGER;
BEGIN
  -- Dismiss trade_closed modals older than 30 minutes
  UPDATE pending_user_modals
  SET 
    dismissed_at = NOW(),
    user_action = 'system_auto_dismissed_stale_timeout'
  WHERE 
    dismissed_at IS NULL
    AND modal_type = 'trade_closed'
    AND created_at < NOW() - INTERVAL '30 minutes';
  
  GET DIAGNOSTICS dismissed_count = ROW_COUNT;
  
  -- Log the cleanup
  IF dismissed_count > 0 THEN
    RAISE NOTICE 'Auto-dismissed % stale modals', dismissed_count;
  END IF;
  
  RETURN dismissed_count;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION auto_dismiss_stale_modals() TO service_role;

-- Add comment
COMMENT ON FUNCTION auto_dismiss_stale_modals() IS 
  'Auto-dismisses pending modals older than 30 minutes to prevent notification loops. Returns count of dismissed modals.';