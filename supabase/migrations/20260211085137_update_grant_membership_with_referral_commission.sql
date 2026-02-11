/*
  # Update grant_club_membership() to Pay Ongoing Referral Commissions

  ## Changes
  Adds call to `pay_referral_commission()` after membership is granted.
  
  ## SSOT Compliance
  All referral commission logic is now in pay_referral_commission()
*/

-- Drop both overloaded versions
DROP FUNCTION IF EXISTS grant_club_membership(UUID, UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS grant_club_membership(UUID, UUID, TEXT, TEXT, NUMERIC);

-- Recreate the 4-parameter version with referral commission logic
CREATE FUNCTION grant_club_membership(
  p_user_id UUID,
  p_package_id UUID,
  p_amount_paid NUMERIC,
  p_stripe_session_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_existing_membership RECORD;
  v_membership_id UUID;
  v_token_amount NUMERIC;
  v_is_upgrade BOOLEAN := FALSE;
  v_commission_result JSONB;
BEGIN
  SELECT * INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  SELECT * INTO v_existing_membership
  FROM club_memberships
  WHERE user_id = p_user_id AND status = 'active'
  ORDER BY tier_level DESC
  LIMIT 1;

  IF v_existing_membership IS NOT NULL THEN
    v_is_upgrade := TRUE;
    
    IF v_existing_membership.tier_level >= v_pkg.tier_level THEN
      RETURN jsonb_build_object('success', false, 'error', 'Already at this tier or higher');
    END IF;

    UPDATE club_memberships SET status = 'upgraded', updated_at = now()
    WHERE id = v_existing_membership.id;

    IF v_existing_membership.tokens_locked > 0 THEN
      UPDATE club_token_balances
      SET locked_tokens = GREATEST(locked_tokens - v_existing_membership.tokens_locked, 0), updated_at = now()
      WHERE user_id = p_user_id;

      INSERT INTO club_token_ledger (user_id, transaction_type, amount, balance_after, reference_id, description)
      SELECT p_user_id, 'membership_upgrade_unlock', v_existing_membership.tokens_locked,
             COALESCE(total_tokens, 0), v_existing_membership.id, 'Tokens unlocked for upgrade'
      FROM club_token_balances WHERE user_id = p_user_id;
    END IF;
  END IF;

  INSERT INTO club_memberships (user_id, package_id, tier_level, status, amount_paid_usd, stripe_session_id, tokens_locked)
  VALUES (p_user_id, p_package_id, v_pkg.tier_level, 'active', p_amount_paid, p_stripe_session_id, v_pkg.required_token_balance)
  RETURNING id INTO v_membership_id;

  v_token_amount := v_pkg.initial_token_allocation;

  PERFORM add_club_tokens(p_user_id, v_token_amount, 'membership_purchase',
    'Initial allocation: ' || v_token_amount || ' PIP for ' || v_pkg.name,
    v_membership_id, 'membership', NULL, 'COMMUNITY_INCENTIVES');

  IF v_pkg.required_token_balance > 0 THEN
    UPDATE club_token_balances SET locked_tokens = v_pkg.required_token_balance, updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO club_token_ledger (user_id, transaction_type, amount, balance_after, reference_id, description)
    SELECT p_user_id, 'membership_lock', -v_pkg.required_token_balance,
           COALESCE(total_tokens, 0), v_membership_id, 'Locked for membership'
    FROM club_token_balances WHERE user_id = p_user_id;
  END IF;

  -- ONGOING REFERRAL COMMISSION SYSTEM
  BEGIN
    v_commission_result := pay_referral_commission(p_user_id, p_package_id, p_amount_paid, v_membership_id, v_is_upgrade);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Referral commission failed: %', SQLERRM;
    v_commission_result := jsonb_build_object('error', SQLERRM);
  END;

  INSERT INTO goal_notifications (user_id, type, title, message, priority, metadata)
  VALUES (p_user_id, 'system_alert',
    CASE WHEN v_is_upgrade THEN 'Membership Upgraded!' ELSE 'Welcome to ' || v_pkg.name || '!' END,
    'Your ' || v_pkg.name || ' membership is active. You received ' || v_token_amount || ' PIP tokens.',
    'high',
    jsonb_build_object('membership_id', v_membership_id, 'tier_level', v_pkg.tier_level,
                       'tokens_awarded', v_token_amount, 'is_upgrade', v_is_upgrade));

  RETURN jsonb_build_object('success', true, 'membership_id', v_membership_id,
    'tier_level', v_pkg.tier_level, 'tokens_awarded', v_token_amount,
    'is_upgrade', v_is_upgrade, 'commission_result', v_commission_result);
END;
$$;

GRANT EXECUTE ON FUNCTION grant_club_membership TO service_role;