/*
  # Reset Admin Account Password

  ## Summary
  This migration ensures the admin@pipnosis.com account has the correct password set.
  It uses Supabase's password update functionality to set a known password for development.

  ## Changes
  1. Updates the admin account password hash to match 'admin123'
  
  ## Security Note
  This is for development/demo purposes only. In production, use strong passwords
  and change them immediately after first login.
*/

-- Update the admin user password
-- Note: This uses Supabase's crypt function to hash the password properly
UPDATE auth.users
SET 
  encrypted_password = crypt('admin123', gen_salt('bf')),
  updated_at = now()
WHERE email = 'admin@pipnosis.com';
