/*
  # Fix Critical Security Issue: Default User Role
  
  ## Problem
  Currently, ALL new users are assigned 'admin' role on signup, giving them:
  - Full access to Admin Dashboard
  - Ability to view all users' data
  - System-wide permissions
  
  ## Solution
  Change default role from 'admin' to 'user' for new signups.
  Only manually promoted users should have admin access.
  
  ## Changes
  1. Update handle_new_user_role() trigger to assign 'user' role by default
  2. Verify existing admin access remains for ksweat48@gmail.com
  
  ## Security Impact
  - Prevents unauthorized admin access
  - Users must be explicitly granted admin privileges
  - Maintains principle of least privilege
*/

-- Update the signup trigger to assign 'user' role by default
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- New users get 'user' role, NOT 'admin'
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create user role: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure ksweat48@gmail.com retains admin access
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  -- Get the user ID for ksweat48@gmail.com
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = 'ksweat48@gmail.com';
  
  -- If user exists, ensure they have admin role
  IF admin_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (admin_user_id, 'admin')
    ON CONFLICT (user_id) 
    DO UPDATE SET role = 'admin', updated_at = now();
  END IF;
END $$;
