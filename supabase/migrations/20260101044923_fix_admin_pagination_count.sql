/*
  # Fix Admin Pagination Count Issue

  ## Problem
  Admin dashboard shows "Showing 1 to 1 of 1 users" despite having 40+ users.

  Root cause:
  - The count query in getAllUsersPaginated() uses direct Supabase query to user_profiles
  - This direct query is subject to Row Level Security (RLS) policies
  - RLS limits the count to only the current admin user (1)
  - Meanwhile, admin_get_all_users_paginated() uses SECURITY DEFINER, which bypasses RLS
  - This creates a mismatch: count = 1, but actual data returns all users

  ## Solution
  Create admin_count_users() RPC function with SECURITY DEFINER to match the data query's permissions.
  - Uses same security check as admin_get_all_users_paginated
  - Accepts optional search_email parameter for filtered counts
  - Returns simple integer count
  - Bypasses RLS using SECURITY DEFINER

  ## Security
  - Admin-only access enforced via explicit check
  - Uses SECURITY DEFINER to bypass RLS (same as data query)
  - Same security pattern as all other admin functions
*/

-- Create count function for admin user pagination
CREATE OR REPLACE FUNCTION admin_count_users(
  search_email text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  user_count bigint;
BEGIN
  -- Security check: Only admins can count users
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Count users with optional email filter (same filter as paginated query)
  SELECT COUNT(*)
  INTO user_count
  FROM user_profiles up
  WHERE (search_email IS NULL OR up.email ILIKE '%' || search_email || '%');

  RETURN user_count;
END;
$$;

-- Grant execute permission to authenticated users (admin check is in function)
GRANT EXECUTE ON FUNCTION admin_count_users(text) TO authenticated;

-- Add comment
COMMENT ON FUNCTION admin_count_users IS
  'Returns total count of users for admin pagination.
   Uses SECURITY DEFINER to bypass RLS (matches admin_get_all_users_paginated permissions).
   Accepts optional search_email parameter for filtered counts.
   Admin-only access enforced via explicit permission check.';
