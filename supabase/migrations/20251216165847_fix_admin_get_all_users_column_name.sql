/*
  # Fix admin_get_all_users Column Name Issue
  
  ## Problem
  The function is querying user_profiles.user_id but the column is actually user_profiles.id
  This causes the query to fail and return no results.
  
  ## Solution
  Update the function to use the correct column name: id instead of user_id
*/

-- Drop and recreate the function with correct column names
DROP FUNCTION IF EXISTS admin_get_all_users(text, integer);

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
  -- Check if calling user is admin (use 'id' not 'user_id')
  SELECT up.is_admin INTO calling_user_is_admin
  FROM user_profiles up
  WHERE up.id = auth.uid();

  IF NOT COALESCE(calling_user_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.id as user_id,  -- Use 'id' from user_profiles
    au.email::text,
    up.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0) as credit_balance,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.id AND gst.status = 'closed'),
      0
    )::bigint as total_trades,
    COALESCE(
      (SELECT COUNT(*) FROM goal_session_trades gst WHERE gst.user_id = up.id AND gst.status = 'open'),
      0
    )::bigint as active_trades,
    COALESCE(
      (SELECT COUNT(*) FROM goal_sessions gs WHERE gs.user_id = up.id AND gs.status = 'scanning'),
      0
    )::bigint as scanning_sessions,
    GREATEST(
      up.created_at,
      COALESCE((SELECT MAX(closed_at) FROM goal_session_trades gst WHERE gst.user_id = up.id), up.created_at),
      COALESCE((SELECT MAX(updated_at) FROM goal_sessions gs WHERE gs.user_id = up.id), up.created_at)
    ) as last_activity
  FROM user_profiles up
  INNER JOIN auth.users au ON au.id = up.id
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE
    (search_email IS NULL OR au.email ILIKE '%' || search_email || '%')
  ORDER BY up.created_at DESC
  LIMIT limit_count;
END;
$$;
