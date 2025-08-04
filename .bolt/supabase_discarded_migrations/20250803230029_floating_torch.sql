/*
  # Setup Admin Account for Haggai Green

  1. User Setup
    - Creates admin user account for ksweat48@gmail.com
    - Sets up user profile with admin privileges
    - Configures enhanced account balance and permissions

  2. Admin Privileges
    - Role: 'admin'
    - Plan Type: 'admin' 
    - Enhanced account balance: $50,000
    - Full name: 'Haggai Green'

  3. Security
    - Uses Supabase's built-in authentication
    - Applies existing RLS policies
    - Admin can access all trade sessions and user data
*/

-- First, insert the user into auth.users (this creates the authentication record)
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role,
  aud,
  confirmation_token,
  email_change_token_new,
  recovery_token
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'ksweat48@gmail.com',
  crypt('Haggai2112_', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Haggai Green"}',
  false,
  'authenticated',
  'authenticated',
  '',
  '',
  ''
) ON CONFLICT (email) DO NOTHING;

-- Get the user ID for the admin user
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  -- Get the user ID from auth.users
  SELECT id INTO admin_user_id 
  FROM auth.users 
  WHERE email = 'ksweat48@gmail.com';
  
  -- If user exists, create or update their profile
  IF admin_user_id IS NOT NULL THEN
    -- Insert or update the user profile
    INSERT INTO user_profiles (
      id,
      email,
      full_name,
      plan_type,
      account_balance,
      risk_profile,
      role,
      trading_preferences,
      created_at,
      updated_at
    ) VALUES (
      admin_user_id,
      'ksweat48@gmail.com',
      'Haggai Green',
      'admin',
      50000.00,
      'auto',
      'admin',
      jsonb_build_object(
        'default_pairs', ARRAY['EURUSD', 'GBPUSD', 'USDJPY'],
        'max_trades_per_session', 5,
        'preferred_timeframe', 'H1',
        'admin_permissions', ARRAY['view_all_users', 'manage_trades', 'access_analytics'],
        'role', 'admin'
      ),
      now(),
      now()
    ) ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      plan_type = EXCLUDED.plan_type,
      account_balance = EXCLUDED.account_balance,
      risk_profile = EXCLUDED.risk_profile,
      role = EXCLUDED.role,
      trading_preferences = EXCLUDED.trading_preferences,
      updated_at = now();
    
    RAISE NOTICE 'Admin account setup completed for: %', 'ksweat48@gmail.com';
  ELSE
    RAISE NOTICE 'User not found in auth.users table. Please create the user first.';
  END IF;
END $$;

-- Verify the admin account was created
SELECT 
  up.id,
  up.email,
  up.full_name,
  up.role,
  up.plan_type,
  up.account_balance,
  up.created_at
FROM user_profiles up
WHERE up.email = 'ksweat48@gmail.com';