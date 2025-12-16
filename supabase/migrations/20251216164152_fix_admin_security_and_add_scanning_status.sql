/*
  # Fix Admin Security Issue and Add Scanning Status

  ## Critical Security Fix
  1. All new users are incorrectly assigned admin privileges
  2. handle_new_user() trigger sets is_admin = true for everyone
  3. Need to set is_admin = false for all regular users
  4. Only ksweat48@gmail.com and admin@pipnosis.com should be admin

  ## New Feature
  1. Add scanning status tracking to admin dashboard
  2. Update admin_get_all_users() to include scanning_sessions count
  3. Allow admins to see which users are actively scanning for trades

  ## Security Impact
  - Prevents unauthorized admin access
  - Ensures only designated accounts have admin privileges
  - Maintains principle of least privilege
*/

-- ============================================================================
-- PART 1: Fix Admin Security Issues
-- ============================================================================

-- Update handle_new_user() trigger to set is_admin = false by default
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, is_admin, plan_type, account_balance)
  VALUES (
    NEW.id,
    NEW.email,
    false, -- Regular users should NOT be admin by default
    'beta',
    10000.00
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create user profile: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reset all users to non-admin, then grant admin only to specific emails
UPDATE user_profiles
SET is_admin = false, updated_at = now()
WHERE is_admin = true;

-- Grant admin access only to authorized accounts
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  -- Grant admin to ksweat48@gmail.com
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = 'ksweat48@gmail.com';

  IF admin_user_id IS NOT NULL THEN
    UPDATE user_profiles
    SET is_admin = true, updated_at = now()
    WHERE id = admin_user_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (admin_user_id, 'admin')
    ON CONFLICT (user_id)
    DO UPDATE SET role = 'admin', updated_at = now();
  END IF;

  -- Grant admin to admin@pipnosis.com
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = 'admin@pipnosis.com';

  IF admin_user_id IS NOT NULL THEN
    UPDATE user_profiles
    SET is_admin = true, updated_at = now()
    WHERE id = admin_user_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (admin_user_id, 'admin')
    ON CONFLICT (user_id)
    DO UPDATE SET role = 'admin', updated_at = now();
  END IF;
END $$;

-- Ensure all other users have 'user' role in user_roles table
DO $$
DECLARE
  user_record record;
BEGIN
  FOR user_record IN
    SELECT au.id
    FROM auth.users au
    WHERE NOT EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = au.id
    )
  LOOP
    INSERT INTO user_roles (user_id, role)
    VALUES (user_record.id, 'user')
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================================
-- PART 2: Update Admin Functions to Include Scanning Status
-- ============================================================================

-- Drop the existing function first to allow changing return type
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

-- Recreate admin_get_all_users() with scanning_sessions column
CREATE OR REPLACE FUNCTION admin_get_all_users(
  search_email text DEFAULT NULL,
  limit_count int DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
  account_balance decimal,
  credit_balance decimal,
  total_trades bigint,
  active_trades bigint,
  scanning_sessions bigint,
  last_activity timestamptz
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  calling_user_is_admin boolean;
BEGIN
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.user_id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.user_id,
    au.email::text,
    up.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0) as credit_balance,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.user_id AND gst.status = 'closed'),
      0
    )::bigint as total_trades,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.user_id AND gst.status = 'open'),
      0
    )::bigint as active_trades,
    COALESCE(
      (SELECT COUNT(*) FROM goal_sessions gs WHERE gs.user_id = up.user_id AND gs.status = 'scanning'),
      0
    )::bigint as scanning_sessions,
    GREATEST(
      up.created_at,
      COALESCE((SELECT MAX(closed_at) FROM goal_session_trades gst WHERE gst.user_id = up.user_id), up.created_at),
      COALESCE((SELECT MAX(updated_at) FROM goal_sessions gs WHERE gs.user_id = up.user_id), up.created_at)
    ) as last_activity
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.user_id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.user_id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY up.created_at DESC
  LIMIT limit_count;
END;
$$;

-- ============================================================================
-- PART 3: Add Indexes for Performance
-- ============================================================================

-- Index for faster scanning session queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_user_scanning
ON goal_sessions(user_id, status)
WHERE status = 'scanning';

-- Index for faster active trades queries
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_open
ON goal_session_trades(user_id, status)
WHERE status = 'open';

-- ============================================================================
-- PART 4: Verify Admin Configuration
-- ============================================================================

-- Log admin status for verification
DO $$
DECLARE
  admin_count int;
BEGIN
  SELECT COUNT(*) INTO admin_count
  FROM user_profiles
  WHERE is_admin = true;

  RAISE NOTICE 'Admin security fix completed. Total admins: %', admin_count;
  RAISE NOTICE 'Only ksweat48@gmail.com and admin@pipnosis.com should have admin access.';
END $$;
