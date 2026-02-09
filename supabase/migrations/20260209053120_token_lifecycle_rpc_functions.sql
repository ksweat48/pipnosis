/*
  # Token Lifecycle RPC Functions

  ## Overview
  Creates RPC functions for atomic user token operations:
  - grant_tokens_to_user - Pool → User liquid
  - burn_user_tokens - User liquid → Burned
  - stake_user_tokens - Liquid → Staked
  - unstake_user_tokens - Staked → Liquid
  - accrue_user_reward - External → Rewards pending
  - claim_user_rewards - Rewards pending → Liquid
  - lock_tokens_for_vesting - Liquid → Vested
  - release_vested_tokens - Vested → Liquid
  - admin_adjust_token_balance - Admin adjustment

  ## Security
  - All functions are SECURITY DEFINER
  - Enforce non-transferability (no user-to-user transfers)
  - Create both pool and user event records
  
  ## SSOT Compliance
  - Atomic operations coordinating pool and user mutations
  - Event-sourced audit trail
  - Integrity constraints enforced
*/

-- =====================================================
-- 1. GRANT TOKENS TO USER (Pool → User)
-- =====================================================

CREATE OR REPLACE FUNCTION grant_tokens_to_user(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_source_pool TEXT,
  p_source TEXT,
  p_ref_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Grant amount must be positive';
  END IF;

  -- Debit pool (will fail if insufficient balance)
  PERFORM debit_token_pool(
    p_source_pool,
    p_amount,
    'user_grant',
    p_user_id,
    jsonb_build_object('user_id', p_user_id, 'source', p_source)
  );

  -- Ensure user has token balance record
  INSERT INTO token_balances (user_id, pip_liquid)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Credit user's liquid balance
  UPDATE token_balances
  SET
    pip_liquid = pip_liquid + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Create user event record
  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_user_id,
    'GRANT',
    p_amount,
    'external',
    'liquid',
    p_source,
    p_ref_id,
    jsonb_build_object('source_pool', p_source_pool, 'metadata', p_metadata)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION grant_tokens_to_user TO service_role;
GRANT EXECUTE ON FUNCTION grant_tokens_to_user TO authenticated;

-- =====================================================
-- 2. BURN USER TOKENS (Liquid → Burned)
-- =====================================================

CREATE OR REPLACE FUNCTION burn_user_tokens(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_reason TEXT,
  p_ref_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_liquid_balance DECIMAL(18,4);
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Burn amount must be positive';
  END IF;

  -- Get and lock user balance
  SELECT pip_liquid INTO v_liquid_balance
  FROM token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User token balance not found';
  END IF;

  -- Check sufficient liquid balance
  IF v_liquid_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient liquid balance. User: %, Current: %, Requested: %',
      p_user_id, v_liquid_balance, p_amount;
  END IF;

  -- Deduct from liquid, add to burned_total
  UPDATE token_balances
  SET
    pip_liquid = pip_liquid - p_amount,
    pip_burned_total = pip_burned_total + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Credit BURNED pool
  PERFORM credit_token_pool(
    'BURNED',
    p_amount,
    'user_burn',
    p_user_id,
    jsonb_build_object('user_id', p_user_id, 'reason', p_reason)
  );

  -- Create user event record
  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_user_id,
    'BURN',
    p_amount,
    'liquid',
    'burned',
    p_reason,
    p_ref_id,
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION burn_user_tokens TO service_role;
GRANT EXECUTE ON FUNCTION burn_user_tokens TO authenticated;

-- =====================================================
-- 3. STAKE USER TOKENS (Liquid → Staked)
-- =====================================================

CREATE OR REPLACE FUNCTION stake_user_tokens(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_liquid_balance DECIMAL(18,4);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Stake amount must be positive';
  END IF;

  SELECT pip_liquid INTO v_liquid_balance
  FROM token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User token balance not found';
  END IF;

  IF v_liquid_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient liquid balance for staking';
  END IF;

  UPDATE token_balances
  SET
    pip_liquid = pip_liquid - p_amount,
    pip_staked = pip_staked + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    metadata
  ) VALUES (
    p_user_id,
    'STAKE_LOCK',
    p_amount,
    'liquid',
    'staked',
    'user_stake',
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION stake_user_tokens TO service_role;
GRANT EXECUTE ON FUNCTION stake_user_tokens TO authenticated;

-- =====================================================
-- 4. UNSTAKE USER TOKENS (Staked → Liquid)
-- =====================================================

CREATE OR REPLACE FUNCTION unstake_user_tokens(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_staked_balance DECIMAL(18,4);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Unstake amount must be positive';
  END IF;

  SELECT pip_staked INTO v_staked_balance
  FROM token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User token balance not found';
  END IF;

  IF v_staked_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient staked balance';
  END IF;

  UPDATE token_balances
  SET
    pip_staked = pip_staked - p_amount,
    pip_liquid = pip_liquid + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    metadata
  ) VALUES (
    p_user_id,
    'STAKE_UNLOCK',
    p_amount,
    'staked',
    'liquid',
    'user_unstake',
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION unstake_user_tokens TO service_role;
GRANT EXECUTE ON FUNCTION unstake_user_tokens TO authenticated;

-- =====================================================
-- 5. ACCRUE USER REWARD (External → Rewards Pending)
-- =====================================================

CREATE OR REPLACE FUNCTION accrue_user_reward(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_source TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Reward amount must be positive';
  END IF;

  INSERT INTO token_balances (user_id, pip_rewards_pending)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE token_balances
  SET
    pip_rewards_pending = pip_rewards_pending + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    metadata
  ) VALUES (
    p_user_id,
    'REWARD_ACCRUE',
    p_amount,
    'external',
    'rewards_pending',
    p_source,
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION accrue_user_reward TO service_role;
GRANT EXECUTE ON FUNCTION accrue_user_reward TO authenticated;

-- =====================================================
-- 6. CLAIM USER REWARDS (Rewards Pending → Liquid)
-- =====================================================

CREATE OR REPLACE FUNCTION claim_user_rewards(
  p_user_id UUID
)
RETURNS DECIMAL(18,4)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending_rewards DECIMAL(18,4);
BEGIN
  SELECT pip_rewards_pending INTO v_pending_rewards
  FROM token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_pending_rewards = 0 THEN
    RETURN 0;
  END IF;

  UPDATE token_balances
  SET
    pip_rewards_pending = 0,
    pip_liquid = pip_liquid + v_pending_rewards,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type
  ) VALUES (
    p_user_id,
    'REWARD_CLAIM',
    v_pending_rewards,
    'rewards_pending',
    'liquid',
    'user_claim'
  );

  RETURN v_pending_rewards;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_user_rewards TO service_role;
GRANT EXECUTE ON FUNCTION claim_user_rewards TO authenticated;

-- =====================================================
-- 7. LOCK TOKENS FOR VESTING (Liquid → Vested)
-- =====================================================

CREATE OR REPLACE FUNCTION lock_tokens_for_vesting(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_vesting_schedule JSONB
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_liquid_balance DECIMAL(18,4);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Vesting amount must be positive';
  END IF;

  SELECT pip_liquid INTO v_liquid_balance
  FROM token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User token balance not found';
  END IF;

  IF v_liquid_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient liquid balance for vesting';
  END IF;

  UPDATE token_balances
  SET
    pip_liquid = pip_liquid - p_amount,
    pip_vested = pip_vested + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    metadata
  ) VALUES (
    p_user_id,
    'VEST_LOCK',
    p_amount,
    'liquid',
    'vested',
    'vesting_schedule',
    jsonb_build_object('schedule', p_vesting_schedule)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION lock_tokens_for_vesting TO service_role;
GRANT EXECUTE ON FUNCTION lock_tokens_for_vesting TO authenticated;

-- =====================================================
-- 8. RELEASE VESTED TOKENS (Vested → Liquid)
-- =====================================================

CREATE OR REPLACE FUNCTION release_vested_tokens(
  p_user_id UUID,
  p_amount DECIMAL(18,4),
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_vested_balance DECIMAL(18,4);
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Release amount must be positive';
  END IF;

  SELECT pip_vested INTO v_vested_balance
  FROM token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User token balance not found';
  END IF;

  IF v_vested_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient vested balance';
  END IF;

  UPDATE token_balances
  SET
    pip_vested = pip_vested - p_amount,
    pip_liquid = pip_liquid + p_amount,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    metadata
  ) VALUES (
    p_user_id,
    'VEST_RELEASE',
    p_amount,
    'vested',
    'liquid',
    'vesting_release',
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION release_vested_tokens TO service_role;
GRANT EXECUTE ON FUNCTION release_vested_tokens TO authenticated;

-- =====================================================
-- 9. ADMIN ADJUST TOKEN BALANCE (Emergency)
-- =====================================================

CREATE OR REPLACE FUNCTION admin_adjust_token_balance(
  p_user_id UUID,
  p_bucket TEXT,
  p_amount DECIMAL(18,4),
  p_reason TEXT,
  p_admin_user_id UUID
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = p_admin_user_id;

  IF NOT FOUND OR v_is_admin = false THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Adjustment amount cannot be zero';
  END IF;

  -- Ensure user exists
  INSERT INTO token_balances (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Apply adjustment based on bucket
  CASE p_bucket
    WHEN 'liquid' THEN
      UPDATE token_balances SET pip_liquid = pip_liquid + p_amount, updated_at = now()
      WHERE user_id = p_user_id;
    WHEN 'staked' THEN
      UPDATE token_balances SET pip_staked = pip_staked + p_amount, updated_at = now()
      WHERE user_id = p_user_id;
    WHEN 'rewards_pending' THEN
      UPDATE token_balances SET pip_rewards_pending = pip_rewards_pending + p_amount, updated_at = now()
      WHERE user_id = p_user_id;
    WHEN 'vested' THEN
      UPDATE token_balances SET pip_vested = pip_vested + p_amount, updated_at = now()
      WHERE user_id = p_user_id;
    ELSE
      RAISE EXCEPTION 'Invalid bucket: %', p_bucket;
  END CASE;

  -- Log admin action
  INSERT INTO token_events (
    user_id,
    event_type,
    amount_pip,
    bucket_from,
    bucket_to,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_user_id,
    'ADMIN_ADJUST',
    ABS(p_amount),
    CASE WHEN p_amount < 0 THEN p_bucket ELSE 'external' END,
    CASE WHEN p_amount > 0 THEN p_bucket ELSE 'external' END,
    'admin_adjustment',
    p_admin_user_id,
    jsonb_build_object('reason', p_reason, 'admin_user_id', p_admin_user_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_adjust_token_balance TO service_role;
GRANT EXECUTE ON FUNCTION admin_adjust_token_balance TO authenticated;