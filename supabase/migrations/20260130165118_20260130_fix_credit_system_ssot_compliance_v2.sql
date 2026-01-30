/*
  # Fix Credit System - SSOT, CCIP & Governance Compliance

  ## Issues Fixed
  1. Admin cannot add credits to users (RLS policy blocking)
  2. Ensure new users receive 50 free credits on signup
  3. Establish clear SSOT authority for credit management
  4. Add governance audit trail for all credit transactions

  ## CCIP Compliance
  - System Map: Clear authority for credit operations
  - Logic Contracts: Admin can add credits, new users get 50 free
  - Compatibility: No breaking changes
  - Staged: RLS policies fixed, no data migration needed

  ## SSOT Authority
  - CreditManagementAuthority owns all credit balance changes
  - Single place where balance is updated (user_token_balance table)
  - All credit changes logged to governance audit trail
*/

-- ============================================================================
-- PART 1: Create Governance Audit Table for Credit Transactions
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_transaction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type text NOT NULL,
  amount numeric(20, 8) NOT NULL,
  old_balance numeric(20, 8),
  new_balance numeric(20, 8),
  reason text,
  admin_user_id uuid REFERENCES user_profiles(id),
  created_at timestamptz DEFAULT NOW(),

  CONSTRAINT valid_transaction_type CHECK (
    transaction_type IN ('signup_bonus', 'admin_add', 'purchase', 'usage_deduction', 'refund')
  )
);

-- Enable RLS
ALTER TABLE credit_transaction_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own transaction history"
  ON credit_transaction_audit FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all transactions"
  ON credit_transaction_audit FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Service role can insert transactions"
  ON credit_transaction_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================================
-- PART 2: Fix RLS Policy - Allow SECURITY DEFINER Functions to Update Balance
-- ============================================================================

-- Drop old trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop old restrictive policy
DROP POLICY IF EXISTS "Users can view own token balance" ON user_token_balance;

-- Create new policies that allow SECURITY DEFINER functions
CREATE POLICY "Service role manages token balances"
  ON user_token_balance FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view own token balance"
  ON user_token_balance FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- PART 3: Recreate handle_new_user with Governance Audit
-- ============================================================================

DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
BEGIN
  -- SSOT AUTHORITY: CreditManagementAuthority + UserInitializationAuthority
  -- RESPONSIBILITY: Create user profile and assign 50 free credits on signup

  -- Step 1: Create user profile
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    plan_type,
    account_balance,
    risk_profile,
    trading_preferences,
    is_admin
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'free',
    10000.00,
    'auto',
    '{}'::jsonb,
    NEW.email = ANY(ARRAY['ksweat48@gmail.com', 'admin@pipnosis.com'])
  )
  ON CONFLICT (id) DO NOTHING;

  -- Step 2: Create token balance with 50 free credits
  INSERT INTO public.user_token_balance (
    user_id,
    balance,
    lifetime_earned,
    last_updated
  )
  VALUES (
    NEW.id,
    50.00,
    50.00,
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Step 3: Audit the signup bonus (non-critical)
  BEGIN
    INSERT INTO credit_transaction_audit (
      user_id, transaction_type, amount, old_balance, new_balance,
      reason
    )
    VALUES (
      NEW.id,
      'signup_bonus',
      50.00,
      0,
      50.00,
      'New user signup bonus'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to audit signup bonus for %: %', NEW.email, SQLERRM;
  END;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create user profile/token balance for % (ID: %): %',
    NEW.email, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- PART 4: Recreate admin_add_credits_to_user with Governance Audit
-- ============================================================================

DROP FUNCTION IF EXISTS admin_add_credits_to_user(uuid, numeric, text);

CREATE FUNCTION admin_add_credits_to_user(
  target_user_id uuid,
  credit_amount numeric,
  reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calling_user_id uuid;
  is_calling_user_admin boolean;
  old_balance numeric;
  new_balance numeric;
BEGIN
  -- SSOT AUTHORITY: CreditManagementAuthority
  -- RESPONSIBILITY: Add credits to user and maintain audit trail

  -- Step 1: Get and validate calling user is admin
  calling_user_id := auth.uid();

  SELECT up.is_admin INTO is_calling_user_admin
  FROM user_profiles up
  WHERE up.id = calling_user_id;

  IF NOT COALESCE(is_calling_user_admin, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Admin access required'
    );
  END IF;

  -- Step 2: Validate inputs
  IF credit_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Credit amount must be positive'
    );
  END IF;

  IF reason IS NULL OR trim(reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reason is required'
    );
  END IF;

  -- Step 3: Validate target user exists
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = target_user_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Step 4: Get current balance
  SELECT COALESCE(balance, 0) INTO old_balance
  FROM user_token_balance
  WHERE user_id = target_user_id;

  -- Step 5: Update balance (atomic operation)
  INSERT INTO user_token_balance (user_id, balance, lifetime_earned, last_updated)
  VALUES (target_user_id, credit_amount, credit_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET
    balance = user_token_balance.balance + credit_amount,
    lifetime_earned = user_token_balance.lifetime_earned + credit_amount,
    updated_at = NOW();

  -- Step 6: Get new balance
  SELECT balance INTO new_balance
  FROM user_token_balance
  WHERE user_id = target_user_id;

  -- Step 7: Log to audit trail (non-critical)
  BEGIN
    INSERT INTO credit_transaction_audit (
      user_id, transaction_type, amount, old_balance, new_balance,
      reason, admin_user_id
    )
    VALUES (
      target_user_id,
      'admin_add',
      credit_amount,
      old_balance,
      new_balance,
      reason,
      calling_user_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to audit credit transaction: %', SQLERRM;
  END;

  -- Step 8: Return success
  RETURN jsonb_build_object(
    'success', true,
    'old_balance', old_balance,
    'new_balance', new_balance,
    'amount_added', credit_amount,
    'reason', reason
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Unexpected error: ' || SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_add_credits_to_user TO authenticated;

-- ============================================================================
-- PART 5: Create Utility Functions for Credit Management (SSOT Authority)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_credit_balance(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_lifetime_earned numeric;
  v_lifetime_spent numeric;
  v_audit_count integer;
BEGIN
  -- SSOT AUTHORITY: CreditManagementAuthority
  -- RESPONSIBILITY: Single place to read credit balance info

  SELECT balance, lifetime_earned, COALESCE(lifetime_spent, 0)
  INTO v_balance, v_lifetime_earned, v_lifetime_spent
  FROM user_token_balance
  WHERE user_id = target_user_id;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  SELECT COUNT(*) INTO v_audit_count
  FROM credit_transaction_audit
  WHERE user_id = target_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'balance', v_balance,
    'lifetime_earned', v_lifetime_earned,
    'lifetime_spent', v_lifetime_spent,
    'transaction_count', v_audit_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_credit_balance TO authenticated;

-- ============================================================================
-- PART 6: Create Indexes for Performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_credit_transaction_audit_user_id
  ON credit_transaction_audit(user_id);

CREATE INDEX IF NOT EXISTS idx_credit_transaction_audit_type
  ON credit_transaction_audit(transaction_type);

CREATE INDEX IF NOT EXISTS idx_credit_transaction_audit_created_at
  ON credit_transaction_audit(created_at);
