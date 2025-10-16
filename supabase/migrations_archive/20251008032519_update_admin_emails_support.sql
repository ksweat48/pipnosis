/*
  # Update Admin Email Support

  ## Summary
  This migration updates the admin email check function to support multiple admin emails
  instead of hardcoding a single email. It adds support for both ksweat48@gmail.com
  and admin@pipnosis.com as default admin accounts.

  ## Changes
  1. Update check_admin_email() function to check against multiple emails
  2. Set both ksweat48@gmail.com and admin@pipnosis.com as admin users
  
  ## Security
  - Maintains existing RLS policies
  - Admin status can only be set through this trigger or direct database update
*/

-- Update existing admin users
UPDATE user_profiles 
SET is_admin = true 
WHERE email IN ('ksweat48@gmail.com', 'admin@pipnosis.com');

-- Update function to support multiple admin emails
CREATE OR REPLACE FUNCTION public.check_admin_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the email is in the list of admin emails
  IF NEW.email IN ('ksweat48@gmail.com', 'admin@pipnosis.com') THEN
    NEW.is_admin = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
