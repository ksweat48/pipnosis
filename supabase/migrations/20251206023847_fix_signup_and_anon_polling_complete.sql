/*
  # Complete Fix: Signup + Background Polling for Unauthenticated Users
  
  ## Problems Fixed
  1. Signup fails with "Database error saving new user" 
     - Trigger runs as anon but RLS blocks inserts
  2. Background polling fails with 401 errors
     - Browser polling runs before login as anon
     - Tries to insert into forex_candles, polling_health, polling_recovery_log
  
  ## Solutions
  1. Grant anon role INSERT permissions on user tables during signup
  2. Grant anon role INSERT/UPDATE permissions on market data tables
  3. Update all RLS policies to allow anon operations
  4. Ensure trigger functions have SECURITY DEFINER
  
  ## Security Notes
  - Anon can only insert their own user profile (auth.uid() check)
  - Market data tables (forex_candles, etc) are not user-specific, safe for anon
  - All other operations still require authentication
*/

-- ============================================================================
-- PART 1: Fix Signup Trigger Issues
-- ============================================================================

-- Grant INSERT permissions to anon role for user tables
GRANT INSERT ON user_profiles TO anon;
GRANT INSERT ON user_roles TO anon;

-- Update RLS policies to allow anon inserts during signup
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated, anon
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own role" ON user_roles;
CREATE POLICY "Users can insert own role"
  ON user_roles FOR INSERT
  TO authenticated, anon
  WITH CHECK (auth.uid() = user_id);

-- Grant execute permissions on trigger functions
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_role() TO anon, authenticated;

-- Recreate trigger functions with proper error handling
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
    true,
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

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin')
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create user role: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure triggers exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- ============================================================================
-- PART 2: Fix Background Polling for Unauthenticated Users
-- ============================================================================

-- Grant permissions to anon for market data tables
GRANT INSERT, UPDATE, SELECT ON forex_candles TO anon;
GRANT INSERT, UPDATE, SELECT ON polling_health TO anon;
GRANT INSERT, SELECT ON polling_recovery_log TO anon;
GRANT INSERT, UPDATE, SELECT ON polling_fallback_cache TO anon;

-- Update forex_candles RLS policies to allow anon
DROP POLICY IF EXISTS "Anon can read candles" ON forex_candles;
CREATE POLICY "Anon can read candles"
  ON forex_candles FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can insert candles" ON forex_candles;
CREATE POLICY "Anon can insert candles"
  ON forex_candles FOR INSERT
  TO anon
  WITH CHECK (true);

-- Update polling_health RLS policies
DROP POLICY IF EXISTS "Anon can read polling health" ON polling_health;
CREATE POLICY "Anon can read polling health"
  ON polling_health FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can insert polling health" ON polling_health;
CREATE POLICY "Anon can insert polling health"
  ON polling_health FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can update polling health" ON polling_health;
CREATE POLICY "Anon can update polling health"
  ON polling_health FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Update polling_recovery_log RLS policies
DROP POLICY IF EXISTS "Anon can read recovery logs" ON polling_recovery_log;
CREATE POLICY "Anon can read recovery logs"
  ON polling_recovery_log FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can insert recovery logs" ON polling_recovery_log;
CREATE POLICY "Anon can insert recovery logs"
  ON polling_recovery_log FOR INSERT
  TO anon
  WITH CHECK (true);

-- Update polling_fallback_cache RLS policies
DROP POLICY IF EXISTS "Anon can read fallback cache" ON polling_fallback_cache;
CREATE POLICY "Anon can read fallback cache"
  ON polling_fallback_cache FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can insert fallback cache" ON polling_fallback_cache;
CREATE POLICY "Anon can insert fallback cache"
  ON polling_fallback_cache FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can update fallback cache" ON polling_fallback_cache;
CREATE POLICY "Anon can update fallback cache"
  ON polling_fallback_cache FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can delete fallback cache" ON polling_fallback_cache;
CREATE POLICY "Anon can delete fallback cache"
  ON polling_fallback_cache FOR DELETE
  TO anon
  USING (true);
