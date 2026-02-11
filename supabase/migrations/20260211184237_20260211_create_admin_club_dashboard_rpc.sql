/*
  # Create Admin Club Dashboard RPC Functions

  ## Summary
  Instead of using RLS policies that cause infinite recursion, create
  SECURITY DEFINER RPC functions that admins can call to get member data.
  
  ## Functions Created
  1. admin_get_club_members() - Get all club members with token balances
  2. admin_get_club_stats() - Get club statistics (total members, circulating PIP, etc.)
  
  ## Security
  Functions check if caller is admin before returning data.
  Non-admin users get empty results or errors.
  
  ## Expected Result
  Admin dashboard can query member data without RLS blocking.
*/

-- ============================================================================
-- Function: admin_get_club_members
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_club_members()
RETURNS TABLE (
  user_id uuid,
  email text,
  tier_level integer,
  tier_name text,
  status text,
  purchased_at timestamptz,
  total_tokens numeric,
  locked_tokens numeric,
  available_tokens numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Check if caller is admin
  SELECT up.is_admin INTO v_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  -- Return all club members with token balances
  RETURN QUERY
  SELECT 
    cm.user_id,
    up.email,
    cm.tier_level,
    pkg.name as tier_name,
    cm.status,
    cm.purchased_at,
    ctb.total_tokens,
    ctb.locked_tokens,
    ctb.available_tokens
  FROM club_memberships cm
  JOIN user_profiles up ON cm.user_id = up.id
  JOIN club_membership_packages pkg ON cm.package_id = pkg.id
  LEFT JOIN club_token_balances ctb ON cm.user_id = ctb.user_id
  WHERE cm.status = 'active'
  ORDER BY cm.purchased_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_club_members() TO authenticated;

COMMENT ON FUNCTION admin_get_club_members IS
  'CCIP-ADMIN-DASHBOARD-RPC-20260211: Returns all club members with token balances. Only accessible to admin users. Uses SECURITY DEFINER to bypass RLS.';

-- ============================================================================
-- Function: admin_get_club_stats
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_club_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_total_members integer;
  v_circulating_pip numeric;
  v_locked_pip numeric;
  v_total_pip numeric;
BEGIN
  -- Check if caller is admin
  SELECT up.is_admin INTO v_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  -- Calculate stats
  SELECT 
    COUNT(DISTINCT cm.user_id),
    COALESCE(SUM(ctb.available_tokens), 0),
    COALESCE(SUM(ctb.locked_tokens), 0),
    COALESCE(SUM(ctb.total_tokens), 0)
  INTO 
    v_total_members,
    v_circulating_pip,
    v_locked_pip,
    v_total_pip
  FROM club_memberships cm
  LEFT JOIN club_token_balances ctb ON cm.user_id = ctb.user_id
  WHERE cm.status = 'active';

  RETURN jsonb_build_object(
    'total_members', v_total_members,
    'circulating_pip', v_circulating_pip,
    'locked_pip', v_locked_pip,
    'total_pip', v_total_pip
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_club_stats() TO authenticated;

COMMENT ON FUNCTION admin_get_club_stats IS
  'CCIP-ADMIN-DASHBOARD-RPC-20260211: Returns club statistics. Only accessible to admin users. Uses SECURITY DEFINER to bypass RLS.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Created admin RPC functions for club dashboard';
  RAISE NOTICE '   - admin_get_club_members(): Returns all members with token balances';
  RAISE NOTICE '   - admin_get_club_stats(): Returns club statistics';
  RAISE NOTICE '⚠️ Frontend needs to be updated to use these RPC functions';
END $$;
