/*
  # Pay Referral Commission RPC Function

  ## Purpose
  SSOT for all referral commission payments. Calculates and pays commissions on membership purchases/upgrades.

  ## Commission Structure
  - PIP Tokens: Based on `club_membership_packages.referral_bonus_pct` (0-15% of payment / $0.10 per PIP)
  - Cash: Fixed 20% of payment amount (tracked in stats, actual payout handled externally)

  ## Features
  - Checks for permanent referrer in `user_profiles.referred_by_user_id`
  - Idempotent: Won't double-pay for same membership_id
  - Atomic: All token movements logged to ledger
  - Pool-aware: Debits from COMMUNITY_INCENTIVES pool

  ## Parameters
  - p_referee_id: User who made the purchase
  - p_package_id: Membership package purchased
  - p_amount_paid_usd: Payment amount
  - p_membership_id: Membership record ID (for idempotency)
  - p_is_upgrade: TRUE if upgrade, FALSE if initial purchase
*/

CREATE OR REPLACE FUNCTION pay_referral_commission(
  p_referee_id UUID,
  p_package_id UUID,
  p_amount_paid_usd NUMERIC,
  p_membership_id UUID,
  p_is_upgrade BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
  v_pkg RECORD;
  v_pip_commission NUMERIC(12,2);
  v_cash_commission NUMERIC(10,2);
  v_transaction_type TEXT;
  v_referrer_balance NUMERIC(12,2);
BEGIN
  -- Check if already paid (idempotency)
  IF EXISTS (
    SELECT 1 FROM club_token_ledger
    WHERE reference_id::TEXT = p_membership_id::TEXT
      AND reference_type = 'membership'
      AND transaction_type IN ('referral_commission_initial', 'referral_commission_upgrade')
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'paid', false,
      'reason', 'Commission already paid for this membership'
    );
  END IF;

  -- Get permanent referrer
  SELECT referred_by_user_id INTO v_referrer_id
  FROM user_profiles
  WHERE id = p_referee_id;

  -- No referrer = no commission
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'paid', false,
      'reason', 'User has no referrer'
    );
  END IF;

  -- Get package details for commission calculation
  SELECT * INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  -- Calculate PIP commission based on package tier bonus
  -- referral_bonus_pct is percentage (e.g., 5 for 5%)
  -- PIP value reference: 1 PIP = $0.10
  IF v_pkg.referral_bonus_pct > 0 THEN
    v_pip_commission := ROUND(
      (p_amount_paid_usd * (v_pkg.referral_bonus_pct / 100.0)) / 0.10,
      2
    );
  ELSE
    v_pip_commission := 0;
  END IF;

  -- Calculate cash commission (20% of payment)
  v_cash_commission := ROUND(p_amount_paid_usd * 0.20, 2);

  -- Determine transaction type
  v_transaction_type := CASE 
    WHEN p_is_upgrade THEN 'referral_commission_upgrade'
    ELSE 'referral_commission_initial'
  END;

  -- Award PIP tokens to referrer
  IF v_pip_commission > 0 THEN
    -- Ensure referrer has token balance record
    INSERT INTO club_token_balances (user_id, total_tokens, locked_tokens, lifetime_earned, lifetime_spent)
    VALUES (v_referrer_id, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Add tokens
    UPDATE club_token_balances
    SET total_tokens = total_tokens + v_pip_commission,
        lifetime_earned = lifetime_earned + v_pip_commission,
        updated_at = NOW()
    WHERE user_id = v_referrer_id;

    -- Get new balance for ledger
    SELECT (total_tokens - locked_tokens) INTO v_referrer_balance
    FROM club_token_balances WHERE user_id = v_referrer_id;

    -- Log in ledger
    INSERT INTO club_token_ledger (
      user_id, transaction_type, amount, balance_after,
      description, reference_id, reference_type, source_pool_id
    ) VALUES (
      v_referrer_id,
      v_transaction_type,
      v_pip_commission,
      v_referrer_balance,
      'Referral commission: ' || v_pip_commission || ' PIP (' || v_pkg.referral_bonus_pct || '% of $' || p_amount_paid_usd || ')',
      p_membership_id::TEXT,
      'membership',
      'COMMUNITY_INCENTIVES'
    );

    -- Debit from pool
    PERFORM debit_token_pool('COMMUNITY_INCENTIVES', v_pip_commission, 'Referral commission payout');
  END IF;

  -- Update referral stats
  INSERT INTO club_referral_stats (
    user_id, total_referrals, completed_referrals, pending_referrals,
    total_tokens_earned, total_cash_earned_usd, last_referral_at
  ) VALUES (
    v_referrer_id, 0, 0, 0,
    v_pip_commission, v_cash_commission, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_tokens_earned = club_referral_stats.total_tokens_earned + v_pip_commission,
    total_cash_earned_usd = club_referral_stats.total_cash_earned_usd + v_cash_commission,
    last_referral_at = NOW();

  -- Create notification for referrer
  INSERT INTO goal_notifications (
    user_id, type, priority, title, message, metadata
  ) VALUES (
    v_referrer_id,
    'referral_commission_earned',
    'medium',
    'Referral Commission Earned!',
    'You earned ' || v_pip_commission || ' PIP + $' || v_cash_commission || ' from a referral ' || 
    CASE WHEN p_is_upgrade THEN 'upgrade' ELSE 'purchase' END || '.',
    jsonb_build_object(
      'pip_earned', v_pip_commission,
      'cash_earned', v_cash_commission,
      'referee_id', p_referee_id,
      'package_name', v_pkg.name,
      'is_upgrade', p_is_upgrade
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'paid', true,
    'referrer_id', v_referrer_id,
    'pip_commission', v_pip_commission,
    'cash_commission', v_cash_commission,
    'transaction_type', v_transaction_type
  );
END;
$$;

-- Grant execution to service role
GRANT EXECUTE ON FUNCTION pay_referral_commission TO service_role;

-- Add comment
COMMENT ON FUNCTION pay_referral_commission IS
  'SSOT for all referral commission payments. Pays commissions on membership purchases/upgrades. Idempotent and pool-aware.';