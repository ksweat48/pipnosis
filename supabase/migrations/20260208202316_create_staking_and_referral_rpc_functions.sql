/*
  # Create Staking & Referral RPC Functions

  1. New Functions
    - `stake_club_tokens(p_user_id, p_amount, p_duration_days)` - Atomically locks tokens and creates staking position
    - `unstake_club_tokens(p_user_id, p_position_id)` - Unlocks matured staking position and returns tokens
    - `get_user_staking_positions(p_user_id)` - Returns all active/completed staking positions
    - `complete_referral_with_rewards(p_referee_id, p_referrer_pip_bonus, p_cash_commission)` - Atomically completes referral and distributes rewards

  2. Security
    - All functions use SECURITY DEFINER for atomic operations
    - Validation of user membership tier for staking eligibility
    - Minimum stake amount and lock duration enforcement
*/

-- Stake tokens: lock from available balance into staking position
CREATE OR REPLACE FUNCTION stake_club_tokens(
  p_user_id UUID,
  p_amount NUMERIC(12,2),
  p_duration_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance RECORD;
  v_membership RECORD;
  v_tier_weight NUMERIC(5,2);
  v_unlock_at TIMESTAMPTZ;
  v_position_id UUID;
BEGIN
  -- Validate amount
  IF p_amount < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Minimum stake amount is 10 PIP');
  END IF;

  -- Validate duration
  IF p_duration_days < 30 OR p_duration_days > 365 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lock duration must be between 30 and 365 days');
  END IF;

  -- Check membership has staking enabled
  SELECT cmp.staking_enabled, cmp.staking_boost_multiplier
  INTO v_membership
  FROM club_memberships cm
  JOIN club_membership_packages cmp ON cmp.id = cm.package_id
  WHERE cm.user_id = p_user_id AND cm.status = 'active';

  IF NOT FOUND OR v_membership.staking_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staking requires Builder tier or above');
  END IF;

  v_tier_weight := COALESCE(v_membership.staking_boost_multiplier, 1.0);

  -- Check available balance
  SELECT total_tokens, locked_tokens, (total_tokens - locked_tokens) AS available
  INTO v_balance
  FROM club_token_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance.available < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient available tokens');
  END IF;

  v_unlock_at := NOW() + (p_duration_days || ' days')::INTERVAL;

  -- Lock the tokens
  UPDATE club_token_balances
  SET locked_tokens = locked_tokens + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Create staking position
  INSERT INTO club_staking_positions (
    user_id, amount_staked, duration_days, unlock_at, tier_weight, status
  ) VALUES (
    p_user_id, p_amount, p_duration_days, v_unlock_at, v_tier_weight, 'active'
  ) RETURNING id INTO v_position_id;

  -- Log in ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after, description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'staking_lock', -p_amount,
    v_balance.available - p_amount,
    'Staked ' || p_amount || ' PIP for ' || p_duration_days || ' days',
    v_position_id::TEXT, 'staking'
  );

  RETURN jsonb_build_object(
    'success', true,
    'position_id', v_position_id,
    'amount', p_amount,
    'unlock_at', v_unlock_at,
    'tier_weight', v_tier_weight
  );
END;
$$;

-- Unstake tokens: unlock matured position and return tokens
CREATE OR REPLACE FUNCTION unstake_club_tokens(
  p_user_id UUID,
  p_position_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_position RECORD;
  v_new_available NUMERIC(12,2);
BEGIN
  -- Get and lock the position
  SELECT * INTO v_position
  FROM club_staking_positions
  WHERE id = p_position_id AND user_id = p_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staking position not found or already unlocked');
  END IF;

  -- Check if matured
  IF v_position.unlock_at > NOW() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Position not yet matured',
      'unlock_at', v_position.unlock_at
    );
  END IF;

  -- Mark position as completed
  UPDATE club_staking_positions
  SET status = 'completed', updated_at = NOW()
  WHERE id = p_position_id;

  -- Unlock the tokens
  UPDATE club_token_balances
  SET locked_tokens = GREATEST(locked_tokens - v_position.amount_staked, 0),
      updated_at = NOW()
  WHERE user_id = p_user_id;

  SELECT (total_tokens - locked_tokens) INTO v_new_available
  FROM club_token_balances WHERE user_id = p_user_id;

  -- Log in ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after, description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'staking_unlock', v_position.amount_staked,
    v_new_available,
    'Unstaked ' || v_position.amount_staked || ' PIP (matured)',
    p_position_id::TEXT, 'staking'
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount_returned', v_position.amount_staked,
    'rewards_earned', v_position.rewards_earned,
    'new_available', v_new_available
  );
END;
$$;

-- Get all staking positions for a user
CREATE OR REPLACE FUNCTION get_user_staking_positions(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  amount_staked NUMERIC(12,2),
  staked_at TIMESTAMPTZ,
  unlock_at TIMESTAMPTZ,
  duration_days INTEGER,
  status TEXT,
  tier_weight NUMERIC(5,2),
  rewards_earned NUMERIC(12,2),
  last_reward_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sp.id, sp.amount_staked, sp.staked_at, sp.unlock_at,
    sp.duration_days, sp.status, sp.tier_weight,
    sp.rewards_earned, sp.last_reward_at
  FROM club_staking_positions sp
  WHERE sp.user_id = p_user_id
  ORDER BY sp.staked_at DESC;
END;
$$;

-- Complete referral with reward distribution
CREATE OR REPLACE FUNCTION complete_referral_with_rewards(
  p_referee_id UUID,
  p_referrer_pip_bonus NUMERIC(12,2),
  p_cash_commission NUMERIC(10,2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referral RECORD;
  v_referrer_balance NUMERIC(12,2);
BEGIN
  -- Find pending referral for this referee
  SELECT * INTO v_referral
  FROM club_referrals
  WHERE referee_id = p_referee_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No pending referral found');
  END IF;

  -- Mark referral as completed
  UPDATE club_referrals
  SET status = 'completed',
      completed_at = NOW(),
      tokens_awarded = p_referrer_pip_bonus,
      cash_awarded_usd = p_cash_commission,
      reward_paid = true
  WHERE id = v_referral.id;

  -- Award PIP tokens to referrer
  IF p_referrer_pip_bonus > 0 THEN
    -- Update balance
    UPDATE club_token_balances
    SET total_tokens = total_tokens + p_referrer_pip_bonus,
        lifetime_earned = lifetime_earned + p_referrer_pip_bonus,
        updated_at = NOW()
    WHERE user_id = v_referral.referrer_id;

    -- Get new available balance for ledger
    SELECT (total_tokens - locked_tokens) INTO v_referrer_balance
    FROM club_token_balances WHERE user_id = v_referral.referrer_id;

    -- Log in ledger
    INSERT INTO club_token_ledger (
      user_id, transaction_type, amount, balance_after, description, reference_id, reference_type
    ) VALUES (
      v_referral.referrer_id, 'referral_reward', p_referrer_pip_bonus,
      v_referrer_balance,
      'Referral reward: ' || p_referrer_pip_bonus || ' PIP',
      v_referral.id::TEXT, 'referral'
    );
  END IF;

  -- Update referral stats (upsert)
  INSERT INTO club_referral_stats (
    user_id, total_referrals, completed_referrals, pending_referrals,
    total_tokens_earned, total_cash_earned_usd, last_referral_at
  ) VALUES (
    v_referral.referrer_id, 1, 1, 0,
    p_referrer_pip_bonus, p_cash_commission, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    completed_referrals = club_referral_stats.completed_referrals + 1,
    pending_referrals = GREATEST(club_referral_stats.pending_referrals - 1, 0),
    total_tokens_earned = club_referral_stats.total_tokens_earned + p_referrer_pip_bonus,
    total_cash_earned_usd = club_referral_stats.total_cash_earned_usd + p_cash_commission,
    last_referral_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referral.referrer_id,
    'pip_awarded', p_referrer_pip_bonus,
    'cash_awarded', p_cash_commission
  );
END;
$$;
