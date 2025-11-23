-- ============================================================================
-- QUICK FIX: Grant Admin Access
-- ============================================================================
-- Copy and paste this entire script into your Supabase SQL Editor and run it.
-- This will grant admin access to all users and fix the "Access Denied" issue.
-- ============================================================================

-- Step 1: Grant admin to all existing users
UPDATE user_profiles
SET is_admin = true
WHERE email IS NOT NULL;

-- Step 2: Create profiles for any users missing them
INSERT INTO user_profiles (id, email, is_admin, plan_type, account_balance)
SELECT
  id,
  email,
  true, -- Grant admin access
  'beta',
  10000.00
FROM auth.users
WHERE id NOT IN (SELECT id FROM user_profiles)
ON CONFLICT (id) DO UPDATE
SET is_admin = true;

-- Step 3: Verify admin users
SELECT
  email,
  is_admin,
  plan_type,
  created_at
FROM user_profiles
WHERE is_admin = true
ORDER BY created_at DESC;

-- ============================================================================
-- SUCCESS! You should see a list of admin users above.
-- Now refresh the AI Training Lab page - you should have access!
-- ============================================================================
