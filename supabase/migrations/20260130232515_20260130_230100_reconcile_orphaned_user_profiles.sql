/*
  # Reconcile Orphaned User Profiles

  **CCIP Stage 1**: Reconciliation

  ## Problem
  Two users have auth.users records but missing user_profiles:
  - boukielyngo@gmail.com (5bea929d-7dc2-4b1a-bbb0-6caa735866eb)
  - trevaunjackson1999@gmail.com (c0598722-c430-4996-b10f-997f86d5fb91)

  ## Solution
  Create missing user_profiles with proper default values:
  - email: from auth.users
  - account_balance: 0 (will be recalculated based on trades)
  - is_admin: false (default user)
  - created_at: preserved from auth.users
  - updated_at: current timestamp

  ## Safety
  - Uses ON CONFLICT DO NOTHING for idempotency
  - Preserves all existing goal_sessions and trades
  - No data deletion
  - Fully reversible (can delete profiles if needed, but NOT recommended)

  ## Changes
  - Inserts 2 missing user_profiles
  - Restores referential integrity for existing child records
  - Enables proper admin dashboard display
*/

-- Create missing user_profiles for orphaned auth.users
INSERT INTO user_profiles (
  id,
  email,
  account_balance,
  is_admin,
  created_at,
  updated_at
)
SELECT 
  au.id,
  au.email,
  0 as account_balance,  -- Default balance, will be recalculated based on trades
  false as is_admin,      -- Default to non-admin
  au.created_at,
  NOW() as updated_at
FROM auth.users au
LEFT JOIN user_profiles up ON up.id = au.id
WHERE up.id IS NULL  -- Only create for orphaned users
ON CONFLICT (id) DO NOTHING;

-- Log reconciliation results
DO $$
DECLARE
  v_total_users int;
  v_orphaned_count int;
BEGIN
  -- Count total users
  SELECT COUNT(*) INTO v_total_users FROM user_profiles;
  
  -- Count remaining orphaned users (should be 0)
  SELECT COUNT(*) INTO v_orphaned_count
  FROM auth.users au
  LEFT JOIN user_profiles up ON up.id = au.id
  WHERE up.id IS NULL;
  
  RAISE NOTICE 'Reconciliation complete. Total user_profiles: %. Remaining orphaned: %', v_total_users, v_orphaned_count;
  
  IF v_orphaned_count > 0 THEN
    RAISE WARNING 'Still have % orphaned users after reconciliation!', v_orphaned_count;
  END IF;
END $$;
