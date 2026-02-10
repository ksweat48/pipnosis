/*
  # Membership Tier Upgrade System

  1. Purpose
    - Allow users to upgrade from a lower membership tier to a higher one
    - Release old locked tokens back to available balance
    - Grant new tier's token allocation
    - Lock new tier's required token balance
    - Full audit trail in club_token_ledger

  2. New Transaction Types
    - `membership_upgrade_unlock` - Tokens released from old tier lock
    - `membership_upgrade_grant` - New tier token allocation awarded
    - `membership_upgrade_lock` - Tokens locked for new tier requirement

  3. New RPC Function
    - `upgrade_club_membership(p_user_id, p_new_package_id, p_stripe_session_id, p_stripe_payment_intent_id, p_amount_paid_usd)`
    - Validates user has active membership
    - Validates target tier is HIGHER than current tier (no downgrades)
    - Atomically: release old lock -> grant new tokens -> lock new requirement
    - Updates membership record in place (respects UNIQUE(user_id) constraint)
    - Logs all token movements to immutable ledger

  4. Token Math Example (Tier 1 -> Tier 2)
    - Before: total=100, locked=100, available=0
    - Step 1: Release old lock => total=100, locked=0, available=100
    - Step 2: Grant new allocation (250) => total=350, locked=0, available=350
    - Step 3: Lock new requirement (250) => total=350, locked=250, available=100

  5. Security
    - SECURITY DEFINER function (elevated privileges)
    - No RLS changes needed
    - Upgrade constraint: target tier MUST be higher than current tier
*/

-- Step 1: Add new transaction types to the constraint
DO $$
BEGIN
  ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS valid_transaction_type;
  ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS club_token_ledger_transaction_type_check;

  ALTER TABLE club_token_ledger ADD CONSTRAINT valid_transaction_type
    CHECK (transaction_type IN (
      'membership_purchase',
      'membership_lock',
      'membership_upgrade_unlock',
      'membership_upgrade_grant',
      'membership_upgrade_lock',
      'referral_reward',
      'staking_reward',
      'admin_grant',
      'admin_deduct',
      'cashout_deduction',
      'promotion_bonus',
      'migration_adjustment',
      'discount_burn',
      'staking_lock',
      'staking_unlock',
      'stake',
      'unstake',
      'reward_claim'
    ));
END $$;

-- Step 2: Create the upgrade RPC function
CREATE OR REPLACE FUNCTION upgrade_club_membership(
  p_user_id UUID,
  p_new_package_id UUID,
  p_stripe_session_id TEXT,
  p_stripe_payment_intent_id TEXT,
  p_amount_paid_usd NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_membership RECORD;
  v_current_pkg RECORD;
  v_new_pkg RECORD;
  v_old_locked INTEGER;
  v_available_after_unlock NUMERIC(12,2);
  v_available_after_grant NUMERIC(12,2);
  v_available_after_lock NUMERIC(12,2);
BEGIN
  -- 1. Validate user has an active membership
  SELECT * INTO v_current_membership
  FROM club_memberships
  WHERE user_id = p_user_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active membership found. Use grant_club_membership for first purchase.'
    );
  END IF;

  -- 2. Get current package details
  SELECT * INTO v_current_pkg
  FROM club_membership_packages
  WHERE id = v_current_membership.package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Current package not found');
  END IF;

  -- 3. Get new package details
  SELECT * INTO v_new_pkg
  FROM club_membership_packages
  WHERE id = p_new_package_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target package not found or inactive');
  END IF;

  -- 4. Enforce upgrade-only (no downgrades, no same-tier)
  IF v_new_pkg.tier_level <= v_current_pkg.tier_level THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot downgrade or repurchase same tier. Target tier must be higher than current tier ' || v_current_pkg.tier_level || '.'
    );
  END IF;

  -- 5. Record old locked amount
  v_old_locked := v_current_membership.tokens_locked;

  -- 6. STEP A: Release old locked tokens
  UPDATE club_token_balances
  SET locked_tokens = GREATEST(locked_tokens - v_old_locked, 0),
      updated_at = NOW()
  WHERE user_id = p_user_id;

  SELECT (total_tokens - locked_tokens) INTO v_available_after_unlock
  FROM club_token_balances WHERE user_id = p_user_id;

  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'membership_upgrade_unlock', v_old_locked,
    v_available_after_unlock,
    'Released ' || v_old_locked || ' PIP from ' || v_current_pkg.name || ' membership lock (upgrading to ' || v_new_pkg.name || ')',
    v_current_membership.id, 'membership'
  );

  -- 7. STEP B: Grant new tier token allocation
  UPDATE club_token_balances
  SET total_tokens = total_tokens + v_new_pkg.initial_token_allocation,
      lifetime_earned = lifetime_earned + v_new_pkg.initial_token_allocation,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  SELECT (total_tokens - locked_tokens) INTO v_available_after_grant
  FROM club_token_balances WHERE user_id = p_user_id;

  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'membership_upgrade_grant', v_new_pkg.initial_token_allocation,
    v_available_after_grant,
    'Upgrade allocation: ' || v_new_pkg.initial_token_allocation || ' PIP for ' || v_new_pkg.name || ' membership',
    v_current_membership.id, 'membership'
  );

  -- 8. STEP C: Lock new tier required tokens
  UPDATE club_token_balances
  SET locked_tokens = locked_tokens + v_new_pkg.required_token_balance,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  SELECT (total_tokens - locked_tokens) INTO v_available_after_lock
  FROM club_token_balances WHERE user_id = p_user_id;

  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'membership_upgrade_lock', -v_new_pkg.required_token_balance,
    v_available_after_lock,
    'Locked ' || v_new_pkg.required_token_balance || ' PIP for ' || v_new_pkg.name || ' membership',
    v_current_membership.id, 'membership'
  );

  -- 9. Update the membership record (in place, respects UNIQUE(user_id))
  UPDATE club_memberships
  SET package_id = p_new_package_id,
      tier_level = v_new_pkg.tier_level,
      tokens_locked = v_new_pkg.required_token_balance,
      stripe_session_id = p_stripe_session_id,
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      amount_paid_usd = p_amount_paid_usd,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_upgrade', jsonb_build_object(
          'from_tier', v_current_pkg.tier_level,
          'from_package', v_current_pkg.name,
          'to_tier', v_new_pkg.tier_level,
          'to_package', v_new_pkg.name,
          'old_tokens_released', v_old_locked,
          'new_tokens_granted', v_new_pkg.initial_token_allocation,
          'new_tokens_locked', v_new_pkg.required_token_balance,
          'upgraded_at', NOW(),
          'stripe_session_id', p_stripe_session_id,
          'amount_paid_usd', p_amount_paid_usd
        )
      ),
      updated_at = NOW()
  WHERE id = v_current_membership.id;

  -- 10. Create upgrade notification
  INSERT INTO goal_notifications (
    user_id, type, priority, title, message, metadata
  ) VALUES (
    p_user_id, 'system_alert', 'high',
    'Membership Upgraded!',
    'Your membership has been upgraded from ' || v_current_pkg.name || ' to ' || v_new_pkg.name || '. You received ' || v_new_pkg.initial_token_allocation || ' new PIP tokens.',
    jsonb_build_object(
      'membership_id', v_current_membership.id,
      'from_tier', v_current_pkg.tier_level,
      'from_package', v_current_pkg.name,
      'to_tier', v_new_pkg.tier_level,
      'to_package', v_new_pkg.name,
      'tokens_released', v_old_locked,
      'tokens_granted', v_new_pkg.initial_token_allocation,
      'tokens_locked', v_new_pkg.required_token_balance,
      'amount_paid', p_amount_paid_usd,
      'stripe_session_id', p_stripe_session_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_current_membership.id,
    'from_tier', v_current_pkg.tier_level,
    'from_tier_name', v_current_pkg.name,
    'to_tier', v_new_pkg.tier_level,
    'to_tier_name', v_new_pkg.name,
    'tokens_released', v_old_locked,
    'tokens_granted', v_new_pkg.initial_token_allocation,
    'tokens_locked', v_new_pkg.required_token_balance,
    'available_tokens', v_available_after_lock
  );
END;
$$;
