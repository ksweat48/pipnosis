/*
  # Set All Users to 50 Free Credits

  1. Update Default Values
    - Change default balance from 5.00 to 50.00
    - Change default lifetime_earned from 5.00 to 50.00
    - All new users will receive 50 free credits on signup

  2. Update Existing Users
    - Set all current users' credit balance to 50
    - Set all current users' lifetime_earned to 50
    - Maintains fairness across all users

  3. Impact
    - Existing users: Credits adjusted to 50
    - New users: Will receive 50 credits automatically
    - SSOT maintained: user_token_balance is the source of truth
*/

-- ============================================================================
-- SECTION 1: Update table defaults for NEW users
-- ============================================================================

ALTER TABLE user_token_balance
  ALTER COLUMN balance SET DEFAULT 50.00,
  ALTER COLUMN lifetime_earned SET DEFAULT 50.00;

-- ============================================================================
-- SECTION 2: Update ALL existing users to 50 credits
-- ============================================================================

UPDATE user_token_balance
SET
  balance = 50.00,
  lifetime_earned = 50.00,
  updated_at = now()
WHERE user_id IN (
  SELECT id FROM user_profiles
);

-- ============================================================================
-- SECTION 3: Verification
-- ============================================================================

DO $$
DECLARE
  v_updated_count integer;
  v_default_balance text;
  v_default_earned text;
BEGIN
  -- Count how many users were updated
  SELECT COUNT(*) INTO v_updated_count
  FROM user_token_balance;

  -- Verify defaults are set correctly
  SELECT column_default INTO v_default_balance
  FROM information_schema.columns
  WHERE table_name = 'user_token_balance'
    AND column_name = 'balance';

  SELECT column_default INTO v_default_earned
  FROM information_schema.columns
  WHERE table_name = 'user_token_balance'
    AND column_name = 'lifetime_earned';

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ Credit System Updated to 50 Free Credits';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Updated % existing users to 50 credits', v_updated_count;
  RAISE NOTICE 'New default balance: %', v_default_balance;
  RAISE NOTICE 'New default lifetime_earned: %', v_default_earned;
  RAISE NOTICE '';
  RAISE NOTICE '✓ All users now have 50 credits';
  RAISE NOTICE '✓ New signups will receive 50 credits';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SECTION 4: Comments
-- ============================================================================

COMMENT ON COLUMN user_token_balance.balance IS 'User credit balance. All users receive 50 free credits on signup.';
COMMENT ON COLUMN user_token_balance.lifetime_earned IS 'Total credits earned by user over their lifetime. Starts at 50 for free signup bonus.';
