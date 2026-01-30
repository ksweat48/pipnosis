/*
  # Add Foreign Key Constraints for User Profiles Referential Integrity

  **CCIP Stage 2**: Referential Integrity Enforcement

  ## Problem
  No foreign key constraints exist to enforce data integrity:
  - user_profiles can be deleted without cascading to auth.users
  - goal_sessions can exist without valid user_profiles
  - goal_session_trades can exist without valid user_profiles

  ## Solution
  Add foreign key constraints with appropriate CASCADE rules:
  - user_profiles.id → auth.users.id (CASCADE on delete - if auth user deleted, profile should go too)
  - goal_sessions.user_id → user_profiles.id (CASCADE on delete - clean up orphaned sessions)
  - goal_session_trades.user_id → user_profiles.id (CASCADE on delete - clean up orphaned trades)

  ## Safety
  - All orphaned records already reconciled in previous migration
  - Constraints will prevent future orphaning
  - Uses IF NOT EXISTS for idempotency
  - CASCADE deletes are appropriate for data integrity

  ## Performance Impact
  - Negligible: indexes already exist on user_id columns
  - Foreign key checks add microseconds to insert/update/delete operations
  - No impact on read operations

  ## Changes
  1. Add FK: user_profiles.id → auth.users.id
  2. Add FK: goal_sessions.user_id → user_profiles.id  
  3. Add FK: goal_session_trades.user_id → user_profiles.id
*/

-- Add foreign key from user_profiles to auth.users
-- This ensures every user_profile has a valid auth.users record
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_profiles_auth_users'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT fk_user_profiles_auth_users
      FOREIGN KEY (id) 
      REFERENCES auth.users(id) 
      ON DELETE CASCADE;
    
    RAISE NOTICE 'Added FK: user_profiles.id → auth.users.id';
  END IF;
END $$;

-- Add foreign key from goal_sessions to user_profiles
-- This ensures every goal_session has a valid user_profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_goal_sessions_user_profiles'
  ) THEN
    ALTER TABLE goal_sessions
      ADD CONSTRAINT fk_goal_sessions_user_profiles
      FOREIGN KEY (user_id) 
      REFERENCES user_profiles(id) 
      ON DELETE CASCADE;
    
    RAISE NOTICE 'Added FK: goal_sessions.user_id → user_profiles.id';
  END IF;
END $$;

-- Add foreign key from goal_session_trades to user_profiles
-- This ensures every trade has a valid user_profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_goal_session_trades_user_profiles'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT fk_goal_session_trades_user_profiles
      FOREIGN KEY (user_id) 
      REFERENCES user_profiles(id) 
      ON DELETE CASCADE;
    
    RAISE NOTICE 'Added FK: goal_session_trades.user_id → user_profiles.id';
  END IF;
END $$;

-- Verify no orphaned records exist after constraint addition
DO $$
DECLARE
  v_orphaned_sessions int;
  v_orphaned_trades int;
BEGIN
  -- Check for orphaned sessions
  SELECT COUNT(*) INTO v_orphaned_sessions
  FROM goal_sessions gs
  LEFT JOIN user_profiles up ON up.id = gs.user_id
  WHERE up.id IS NULL;
  
  -- Check for orphaned trades
  SELECT COUNT(*) INTO v_orphaned_trades
  FROM goal_session_trades gst
  LEFT JOIN user_profiles up ON up.id = gst.user_id
  WHERE up.id IS NULL;
  
  IF v_orphaned_sessions > 0 OR v_orphaned_trades > 0 THEN
    RAISE EXCEPTION 'Found orphaned records! Sessions: %, Trades: %. Cannot add foreign keys.', v_orphaned_sessions, v_orphaned_trades;
  ELSE
    RAISE NOTICE 'Verification passed: No orphaned records found. Foreign keys successfully added.';
  END IF;
END $$;
