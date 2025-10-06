/*
  # Add User Profile Auto-Creation Trigger

  This migration adds a database trigger that automatically creates a user profile
  when a new user signs up through Supabase Auth.

  ## Changes
  
  1. New Function
    - `handle_new_user()` - Automatically creates a user_profiles record when a new user signs up
    - Extracts email and full_name from auth.users metadata
    - Sets default values for account_balance, plan_type, and risk_profile
  
  2. New Trigger
    - Trigger on auth.users table (AFTER INSERT)
    - Calls handle_new_user() function for each new user
  
  ## Security
  
  - Function runs with SECURITY DEFINER privileges to access auth.users
  - Only creates profile on new user insertion
  - Handles metadata gracefully with COALESCE for optional fields
*/

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    plan_type,
    account_balance,
    risk_profile,
    trading_preferences
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'free',
    10000.00,
    'auto',
    '{}'::jsonb
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
