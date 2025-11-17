/*
  # Grant Admin Access and Auto Profile Creation

  1. Changes
    - Grant admin access to current users (based on email)
    - Create function to automatically create user profiles on signup
    - Add trigger to ensure all authenticated users have profiles
    - Ensure existing users without profiles get one created

  2. Security
    - Maintains existing RLS policies
    - Auto-creates profiles for all new users
    - Grants admin to specific email or all users for development
*/

-- Grant admin access to all existing users (for development/testing)
-- In production, you would specify specific email addresses
UPDATE user_profiles
SET is_admin = true
WHERE email IS NOT NULL;

-- If no user_profiles exist, this will handle it gracefully
-- Insert missing profiles for users in auth.users who don't have a profile
INSERT INTO user_profiles (id, email, is_admin, plan_type)
SELECT
  id,
  email,
  true, -- Grant admin to all users for now
  'beta'
FROM auth.users
WHERE id NOT IN (SELECT id FROM user_profiles)
ON CONFLICT (id) DO NOTHING;

-- Create function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, is_admin, plan_type, account_balance)
  VALUES (
    NEW.id,
    NEW.email,
    true, -- Set to true for development, false for production
    'beta',
    10000.00
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to run on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to check if user is admin (helper for RLS policies)
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = user_id AND is_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
