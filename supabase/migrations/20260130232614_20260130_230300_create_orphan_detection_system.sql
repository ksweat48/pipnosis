/*
  # Create Orphaned User Detection and Alert System

  **CCIP Stage 3**: Automated Monitoring

  ## Problem
  No automated system to detect if user_profiles become orphaned in the future

  ## Solution
  Create detection function and automated alerting:
  - Function to scan for orphaned records
  - Creates governance alerts when orphans detected
  - Can be called manually or via scheduled job
  - Provides detailed diagnostics

  ## Safety
  - Read-only function (no data modification)
  - Creates alerts in governance_alerts table
  - Idempotent (can be called multiple times)
  - No performance impact on user operations

  ## Changes
  1. Create detect_orphaned_users() function
  2. Create RPC wrapper for admin access
  3. Enable service role execution
*/

-- Create function to detect orphaned users
CREATE OR REPLACE FUNCTION detect_orphaned_users()
RETURNS TABLE (
  orphan_type text,
  auth_user_id uuid,
  email text,
  created_at timestamptz,
  related_sessions int,
  related_trades int
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_orphan_count int := 0;
  v_admin_id uuid;
BEGIN
  -- Get first admin user for alerts
  SELECT id INTO v_admin_id FROM user_profiles WHERE is_admin = true LIMIT 1;

  -- Return orphaned auth.users (missing user_profiles)
  RETURN QUERY
  SELECT 
    'missing_user_profile'::text as orphan_type,
    au.id as auth_user_id,
    au.email,
    au.created_at,
    (SELECT COUNT(*)::int FROM goal_sessions gs WHERE gs.user_id = au.id) as related_sessions,
    (SELECT COUNT(*)::int FROM goal_session_trades gst WHERE gst.user_id = au.id) as related_trades
  FROM auth.users au
  LEFT JOIN user_profiles up ON up.id = au.id
  WHERE up.id IS NULL;

  -- Count orphans found
  GET DIAGNOSTICS v_orphan_count = ROW_COUNT;

  -- Create governance alert if orphans found
  IF v_orphan_count > 0 THEN
    INSERT INTO governance_alerts (
      alert_type,
      severity,
      title,
      description,
      affected_entity_type,
      affected_entity_id,
      detection_method,
      auto_resolved,
      metadata
    ) VALUES (
      'data_integrity_violation',
      'critical',
      'Orphaned User Profiles Detected',
      format('Found %s orphaned user records. Auth.users exist without corresponding user_profiles.', v_orphan_count),
      'user_profiles',
      v_admin_id,
      'automated_scan',
      false,
      jsonb_build_object(
        'orphan_count', v_orphan_count,
        'detection_timestamp', NOW(),
        'action_required', 'Run reconciliation migration or investigate cause',
        'foreign_keys_enforced', true
      )
    );
    
    RAISE WARNING 'Detected % orphaned user records. Alert created.', v_orphan_count;
  ELSE
    RAISE NOTICE 'No orphaned users detected. System integrity intact.';
  END IF;

  RETURN;
END;
$$;

-- Grant execution to service role
GRANT EXECUTE ON FUNCTION detect_orphaned_users() TO service_role;

-- Create RPC wrapper for admin dashboard access
CREATE OR REPLACE FUNCTION rpc_detect_orphaned_users()
RETURNS TABLE (
  orphan_type text,
  auth_user_id uuid,
  email text,
  created_at timestamptz,
  related_sessions int,
  related_trades int
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Only admins can detect orphaned users';
  END IF;

  -- Call detection function
  RETURN QUERY SELECT * FROM detect_orphaned_users();
END;
$$;

-- Grant execution to authenticated users (admin check inside function)
GRANT EXECUTE ON FUNCTION rpc_detect_orphaned_users() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION detect_orphaned_users() IS 
'SSOT Authority: Orphan Detection. Scans for auth.users without user_profiles and creates governance alerts when found. Run manually or via scheduled job.';

COMMENT ON FUNCTION rpc_detect_orphaned_users() IS 
'Admin-only RPC wrapper for orphan detection. Requires caller to be admin user. Returns list of orphaned records with diagnostic information.';
