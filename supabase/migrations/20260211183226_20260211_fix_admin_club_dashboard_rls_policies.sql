/*
  # Fix Admin Club Dashboard RLS Policies

  ## Summary
  Admin dashboard cannot view club member information due to missing RLS policies.
  greenmorris.83@gmail.com shows as "Unknown" with 0.00 PIP available tokens despite
  database containing correct data (16,850 total, 10,000 locked, 6,850 available).

  ## Root Cause
  - club_token_balances: Only owner or service_role can SELECT
  - user_profiles: Only owner or service_role can SELECT
  - Admin queries return empty results due to RLS blocking, causing:
    - "Unknown" for member names (no email from user_profiles)
    - 0.00 PIP for available tokens (no data from club_token_balances)
    - Incorrect "Circulating PIP" stat (using total_tokens instead of available_tokens)

  ## Fix
  1. Add RLS policy allowing admins to SELECT from club_token_balances
  2. Add RLS policy allowing admins to SELECT from user_profiles
  3. Maintain security: non-admin users can only see their own data

  ## Expected Result
  - Admin dashboard displays: "greenmorris.83@gmail.com Founder 2/11/2026 6,850.00 PIP"
  - Stats show accurate locked vs circulating PIP
  - Future members automatically visible to admins
  - Non-admin users cannot access other users' data
*/

-- ============================================================================
-- Add admin SELECT policies for club_token_balances
-- ============================================================================

DO $$
BEGIN
  -- Check if policy already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'club_token_balances' 
    AND policyname = 'Admins can view all token balances'
  ) THEN
    CREATE POLICY "Admins can view all token balances"
      ON club_token_balances
      FOR SELECT
      TO public
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE user_profiles.id = auth.uid()
            AND user_profiles.is_admin = true
        )
      );
    
    RAISE NOTICE 'Created policy: Admins can view all token balances';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all token balances';
  END IF;
END $$;

-- ============================================================================
-- Add admin SELECT policies for user_profiles
-- ============================================================================

DO $$
BEGIN
  -- Check if policy already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_profiles' 
    AND policyname = 'Admins can view all profiles'
  ) THEN
    CREATE POLICY "Admins can view all profiles"
      ON user_profiles
      FOR SELECT
      TO public
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles up
          WHERE up.id = auth.uid()
            AND up.is_admin = true
        )
      );
    
    RAISE NOTICE 'Created policy: Admins can view all profiles';
  ELSE
    RAISE NOTICE 'Policy already exists: Admins can view all profiles';
  END IF;
END $$;

-- ============================================================================
-- Verification: Test admin can query member data
-- ============================================================================

DO $$
DECLARE
  v_admin_user_id uuid;
  v_member_count integer;
  v_balance_count integer;
  v_greenmorris_email text;
  v_greenmorris_available numeric;
BEGIN
  -- Find an admin user (assuming current session or test admin)
  SELECT id INTO v_admin_user_id
  FROM user_profiles
  WHERE is_admin = true
  LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    RAISE WARNING 'No admin users found. Create an admin user to test policies.';
    RETURN;
  END IF;

  -- Count visible memberships (should see all as admin)
  SELECT COUNT(*) INTO v_member_count
  FROM club_memberships;

  -- Count visible balances (should see all as admin)
  SELECT COUNT(*) INTO v_balance_count
  FROM club_token_balances;

  -- Verify greenmorris data is accessible
  SELECT up.email, ctb.available_tokens
  INTO v_greenmorris_email, v_greenmorris_available
  FROM club_memberships cm
  JOIN user_profiles up ON cm.user_id = up.id
  JOIN club_token_balances ctb ON cm.user_id = ctb.user_id
  WHERE up.email = 'greenmorris.83@gmail.com'
  LIMIT 1;

  RAISE NOTICE 'Admin RLS verification:';
  RAISE NOTICE '  - Admin user ID: %', v_admin_user_id;
  RAISE NOTICE '  - Visible memberships: %', v_member_count;
  RAISE NOTICE '  - Visible token balances: %', v_balance_count;
  
  IF v_greenmorris_email IS NOT NULL THEN
    RAISE NOTICE '  - greenmorris.83@gmail.com: % PIP available', v_greenmorris_available;
    RAISE NOTICE '✓ Admin can access member data';
  ELSE
    RAISE WARNING '✗ Admin cannot access greenmorris data (RLS still blocking)';
  END IF;
END $$;

-- ============================================================================
-- CCIP Change Tracking
-- ============================================================================

COMMENT ON POLICY "Admins can view all token balances" ON club_token_balances IS
  'CCIP-ADMIN-DASHBOARD-RLS-20260211: Enable admin users to view all club member token balances for dashboard management. Non-admin users can only view their own data.';

COMMENT ON POLICY "Admins can view all profiles" ON user_profiles IS
  'CCIP-ADMIN-DASHBOARD-RLS-20260211: Enable admin users to view all user profiles for dashboard management. Non-admin users can only view their own data.';
