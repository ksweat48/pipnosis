/*
  # Fix grant_club_membership RPC notification type

  1. Problem
    - The `grant_club_membership` function inserts `type = 'system'` into `goal_notifications`
    - The CHECK constraint `valid_notification_type` does NOT allow `'system'` -- only `'system_alert'`
    - This causes the entire RPC transaction to roll back on every membership purchase
    - Stripe webhook receives error and returns 500

  2. Fix
    - Change notification type from `'system'` to `'system_alert'` in step 10 of the function
    - No other changes needed -- priority `'high'` is already valid

  3. Impact
    - Fixes all club membership purchases via Stripe
    - No data loss or schema changes
*/

CREATE OR REPLACE FUNCTION grant_club_membership(
  p_user_id UUID,
  p_package_id UUID,
  p_stripe_session_id TEXT,
  p_stripe_payment_intent_id TEXT,
  p_amount_paid_usd NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pkg RECORD;
  v_existing RECORD;
  v_membership_id UUID;
  v_balance RECORD;
  v_new_available NUMERIC(12,2);
  v_referral RECORD;
BEGIN
  -- 1. Validate package exists and is active
  SELECT * INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  -- 2. Check for existing membership (prevent duplicates)
  SELECT id INTO v_existing
  FROM club_memberships
  WHERE user_id = p_user_id AND status = 'active';

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has an active membership');
  END IF;

  -- 3. Create membership record
  INSERT INTO club_memberships (
    user_id, package_id, tier_level, status,
    purchased_at, activated_at,
    stripe_session_id, stripe_payment_intent_id,
    amount_paid_usd, tokens_locked
  ) VALUES (
    p_user_id, p_package_id, v_pkg.tier_level, 'active',
    NOW(), NOW(),
    p_stripe_session_id, p_stripe_payment_intent_id,
    p_amount_paid_usd, v_pkg.required_token_balance
  ) RETURNING id INTO v_membership_id;

  -- 4. Ensure token balance row exists (upsert)
  INSERT INTO club_token_balances (
    user_id, total_tokens, locked_tokens, staked_tokens, lifetime_earned, lifetime_spent
  ) VALUES (
    p_user_id, 0, 0, 0, 0, 0
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- 5. Award initial token allocation
  UPDATE club_token_balances
  SET total_tokens = total_tokens + v_pkg.initial_token_allocation,
      lifetime_earned = lifetime_earned + v_pkg.initial_token_allocation,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 6. Lock required tokens for membership
  UPDATE club_token_balances
  SET locked_tokens = locked_tokens + v_pkg.required_token_balance,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Get new available balance for ledger entries
  SELECT (total_tokens - locked_tokens) INTO v_new_available
  FROM club_token_balances WHERE user_id = p_user_id;

  -- 7. Log token award in ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'membership_purchase', v_pkg.initial_token_allocation,
    v_new_available + v_pkg.required_token_balance,
    'Initial allocation: ' || v_pkg.initial_token_allocation || ' PIP for ' || v_pkg.name,
    v_membership_id::TEXT, 'membership'
  );

  -- 8. Log token lock in ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'membership_lock', -v_pkg.required_token_balance,
    v_new_available,
    'Locked ' || v_pkg.required_token_balance || ' PIP for ' || v_pkg.name || ' membership',
    v_membership_id::TEXT, 'membership'
  );

  -- 9. Complete pending referral if exists
  SELECT * INTO v_referral
  FROM club_referrals
  WHERE referee_id = p_user_id AND status = 'pending'
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE club_referrals
    SET status = 'completed',
        completed_at = NOW(),
        tokens_awarded = 500,
        cash_awarded_usd = (p_amount_paid_usd * 0.20),
        reward_paid = true
    WHERE id = v_referral.id;

    UPDATE club_token_balances
    SET total_tokens = total_tokens + 500,
        lifetime_earned = lifetime_earned + 500,
        updated_at = NOW()
    WHERE user_id = v_referral.referrer_id;

    INSERT INTO club_token_ledger (
      user_id, transaction_type, amount, balance_after,
      description, reference_id, reference_type
    ) VALUES (
      v_referral.referrer_id, 'referral_reward', 500,
      (SELECT (total_tokens - locked_tokens) FROM club_token_balances WHERE user_id = v_referral.referrer_id),
      'Referral reward: 500 PIP',
      v_referral.id::TEXT, 'referral'
    );

    INSERT INTO club_referral_stats (
      user_id, total_referrals, completed_referrals, pending_referrals,
      total_tokens_earned, total_cash_earned_usd, last_referral_at
    ) VALUES (
      v_referral.referrer_id, 1, 1, 0,
      500, (p_amount_paid_usd * 0.20), NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      completed_referrals = club_referral_stats.completed_referrals + 1,
      pending_referrals = GREATEST(club_referral_stats.pending_referrals - 1, 0),
      total_tokens_earned = club_referral_stats.total_tokens_earned + 500,
      total_cash_earned_usd = club_referral_stats.total_cash_earned_usd + (p_amount_paid_usd * 0.20),
      last_referral_at = NOW();
  END IF;

  -- 10. Create system notification (FIXED: 'system' -> 'system_alert' per CHECK constraint)
  INSERT INTO goal_notifications (
    user_id, type, priority, title, message, metadata
  ) VALUES (
    p_user_id, 'system_alert', 'high',
    'Welcome to Pipnosis Club!',
    'Your ' || v_pkg.name || ' membership is now active. You received ' || v_pkg.initial_token_allocation || ' PIP tokens.',
    jsonb_build_object(
      'membership_id', v_membership_id,
      'package_name', v_pkg.name,
      'tier_level', v_pkg.tier_level,
      'tokens_awarded', v_pkg.initial_token_allocation,
      'tokens_locked', v_pkg.required_token_balance,
      'amount_paid', p_amount_paid_usd,
      'stripe_session_id', p_stripe_session_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'tier_level', v_pkg.tier_level,
    'tier_name', v_pkg.name,
    'tokens_awarded', v_pkg.initial_token_allocation,
    'tokens_locked', v_pkg.required_token_balance
  );
END;
$$;
