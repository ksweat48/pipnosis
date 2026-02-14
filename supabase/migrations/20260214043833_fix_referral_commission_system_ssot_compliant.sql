/*
  # Fix Referral Commission System - SSOT/CCIP Compliant

  ## Problem Summary
  The `pay_referral_commission` function had 5 compounding bugs that prevented
  any referral commission from ever being paid:
  
  1. **Signature mismatch**: `grant_club_membership` called with 5 params but function accepts 2
  2. **Invalid transaction type**: Used `referral_commission_ongoing` not in CHECK constraint
  3. **Wrong column name**: Used `source_pool` instead of `source_pool_id`
  4. **Missing NOT NULL column**: Did not include `balance_after` in INSERT
  5. **Skipped balance update**: Did raw INSERT instead of using `add_club_tokens()` SSOT

  ## Fix Applied
  - Rewrote `pay_referral_commission` to delegate to `add_club_tokens()` (SSOT)
  - Fixed `grant_club_membership` to call with correct 2-param signature
  - Uses `referral_commission_initial` / `referral_commission_upgrade` (valid types)
  - Properly debits `COMMUNITY_INCENTIVES` pool via `add_club_tokens()`
  - Commission rates: 10% PIP (at $0.10/token) + 20% cash, flat across all tiers
  - Ongoing model: referrer earns on every purchase/upgrade indefinitely

  ## Functions Modified
  - `pay_referral_commission(uuid, numeric)` - Complete rewrite
  - `grant_club_membership(uuid, uuid, numeric, text)` - Fixed internal call

  ## Security
  - Both functions remain SECURITY DEFINER
  - RLS policies unchanged
  - Audit trail via `referral_state_audit` preserved
*/

-- ============================================================================
-- 1. Rewrite pay_referral_commission to use add_club_tokens SSOT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pay_referral_commission(
  p_referee_id UUID,
  p_membership_price_usd NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_referrer_id UUID;
  v_referral_id UUID;
  v_pip_commission NUMERIC;
  v_cash_commission NUMERIC;
  v_is_first_commission BOOLEAN;
  v_transaction_type TEXT;
  v_tokens_added BOOLEAN;
  v_pip_token_price CONSTANT NUMERIC := 0.10;
  v_pip_commission_pct CONSTANT NUMERIC := 0.10;
  v_cash_commission_pct CONSTANT NUMERIC := 0.20;
  v_completion_result JSONB;
BEGIN
  -- SSOT: Find referrer from user_profiles (single source for referral relationships)
  SELECT referred_by_user_id
  INTO v_referrer_id
  FROM user_profiles
  WHERE id = p_referee_id;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referrer');
  END IF;

  -- CCIP: Complete the referral with audit trail (pending -> completed)
  v_completion_result := complete_referral_on_purchase(p_referee_id);

  IF NOT COALESCE((v_completion_result->>'success')::boolean, false) THEN
    RAISE NOTICE '[CCIP] Referral completion note: %', v_completion_result->>'error';
  END IF;

  -- Get referral_id from completion result or fetch directly
  v_referral_id := (v_completion_result->>'referral_id')::uuid;

  IF v_referral_id IS NULL THEN
    SELECT id INTO v_referral_id
    FROM club_referrals
    WHERE referee_id = p_referee_id
    AND referrer_id = v_referrer_id
    LIMIT 1;
  END IF;

  IF v_referral_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referral_record');
  END IF;

  -- Determine transaction type based on whether commission was previously paid
  SELECT NOT COALESCE(reward_paid, false)
  INTO v_is_first_commission
  FROM club_referrals
  WHERE id = v_referral_id;

  v_transaction_type := CASE
    WHEN v_is_first_commission THEN 'referral_commission_initial'
    ELSE 'referral_commission_upgrade'
  END;

  -- Calculate commissions (flat across all tiers per SSOT)
  v_pip_commission := ROUND((p_membership_price_usd * v_pip_commission_pct) / v_pip_token_price, 2);
  v_cash_commission := ROUND(p_membership_price_usd * v_cash_commission_pct, 2);

  -- SSOT: Award PIP tokens via add_club_tokens (handles balance, ledger, pool debit atomically)
  v_tokens_added := add_club_tokens(
    v_referrer_id,
    v_pip_commission,
    v_transaction_type,
    format('Referral commission: %s PIP + $%s cash from $%s membership', v_pip_commission, v_cash_commission, p_membership_price_usd),
    v_referral_id,
    'referral',
    NULL,
    'COMMUNITY_INCENTIVES'
  );

  IF NOT v_tokens_added THEN
    RAISE WARNING '[CCIP] add_club_tokens failed for referrer=%, amount=%', v_referrer_id, v_pip_commission;
    RETURN jsonb_build_object('success', false, 'reason', 'token_grant_failed');
  END IF;

  -- Update referral record with commission amounts
  UPDATE club_referrals
  SET
    tokens_awarded = COALESCE(tokens_awarded, 0) + v_pip_commission,
    cash_awarded_usd = COALESCE(cash_awarded_usd, 0) + v_cash_commission,
    reward_paid = true,
    reward_paid_at = COALESCE(reward_paid_at, now()),
    updated_at = now(),
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{last_commission_payment}',
      jsonb_build_object(
        'timestamp', now(),
        'membership_price_usd', p_membership_price_usd,
        'pip_commission', v_pip_commission,
        'cash_commission', v_cash_commission,
        'transaction_type', v_transaction_type
      )
    )
  WHERE id = v_referral_id;

  -- Send notification to referrer
  INSERT INTO goal_notifications (
    user_id, type, title, message, priority,
    reference_id, reference_type, metadata
  ) VALUES (
    v_referrer_id,
    'referral_commission_earned',
    'Referral Commission Earned!',
    format('You earned %s PIP tokens + $%s cash from a referral purchase!', v_pip_commission, v_cash_commission),
    'medium',
    v_referral_id,
    'referral',
    jsonb_build_object(
      'pip_tokens', v_pip_commission,
      'cash_usd', v_cash_commission,
      'membership_price', p_membership_price_usd,
      'transaction_type', v_transaction_type
    )
  );

  -- CCIP: Log commission event in audit trail
  INSERT INTO referral_state_audit (
    referral_id, old_status, new_status,
    old_referee_id, new_referee_id,
    trigger_event, triggered_by, metadata
  ) VALUES (
    v_referral_id, 'completed', 'completed',
    p_referee_id, p_referee_id,
    'commission_paid',
    p_referee_id,
    jsonb_build_object(
      'pip_commission', v_pip_commission,
      'cash_commission', v_cash_commission,
      'membership_price_usd', p_membership_price_usd,
      'transaction_type', v_transaction_type,
      'pool', 'COMMUNITY_INCENTIVES'
    )
  );

  RAISE NOTICE '[CCIP] Paid referral commission: referrer=%, pip=%, cash=$%, type=%',
    v_referrer_id, v_pip_commission, v_cash_commission, v_transaction_type;

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'referral_id', v_referral_id,
    'pip_commission', v_pip_commission,
    'cash_commission', v_cash_commission,
    'transaction_type', v_transaction_type
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[CCIP] pay_referral_commission failed: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$function$;

-- ============================================================================
-- 2. Fix grant_club_membership to call pay_referral_commission with correct signature
-- ============================================================================
CREATE OR REPLACE FUNCTION public.grant_club_membership(
  p_user_id UUID,
  p_package_id UUID,
  p_amount_paid NUMERIC,
  p_stripe_session_id TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_existing_membership RECORD;
  v_membership_id UUID;
  v_cumulative_calculation JSONB;
  v_total_tokens_to_award NUMERIC;
  v_tier_breakdown JSONB;
  v_is_upgrade BOOLEAN := FALSE;
  v_commission_result JSONB;
  v_tier_record JSONB;
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

  v_cumulative_calculation := calculate_cumulative_token_award(p_user_id, v_pkg.tier_level);
  v_total_tokens_to_award := (v_cumulative_calculation->>'total_tokens_to_award')::NUMERIC;
  v_tier_breakdown := v_cumulative_calculation->'tier_breakdown';

  FOR v_tier_record IN SELECT * FROM jsonb_array_elements(v_tier_breakdown)
  LOOP
    IF NOT (v_tier_record->>'already_awarded')::BOOLEAN THEN
      DECLARE
        v_tier_level INTEGER := (v_tier_record->>'tier_level')::INTEGER;
        v_tier_name TEXT := v_tier_record->>'tier_name';
        v_tier_tokens NUMERIC := (v_tier_record->>'tokens')::NUMERIC;
      BEGIN
        PERFORM add_club_tokens(
          p_user_id,
          v_tier_tokens,
          'membership_purchase',
          'Tier ' || v_tier_level || ' (' || v_tier_name || ') bonus: ' || v_tier_tokens || ' PIP',
          v_membership_id,
          'membership',
          NULL,
          'COMMUNITY_INCENTIVES'
        );

        INSERT INTO club_membership_tier_history (user_id, tier_level, tier_name, tokens_awarded, membership_id)
        VALUES (p_user_id, v_tier_level, v_tier_name, v_tier_tokens, v_membership_id);
      END;
    END IF;
  END LOOP;

  IF v_pkg.required_token_balance > 0 THEN
    UPDATE club_token_balances SET locked_tokens = v_pkg.required_token_balance, updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO club_token_ledger (user_id, transaction_type, amount, balance_after, reference_id, description)
    SELECT p_user_id, 'membership_lock', -v_pkg.required_token_balance,
      COALESCE(total_tokens, 0), v_membership_id, 'Locked for ' || v_pkg.name || ' membership'
    FROM club_token_balances WHERE user_id = p_user_id;
  END IF;

  UPDATE club_memberships
  SET cumulative_tokens_awarded = v_total_tokens_to_award
  WHERE id = v_membership_id;

  -- FIXED: Call pay_referral_commission with correct 2-param signature (SSOT)
  BEGIN
    v_commission_result := pay_referral_commission(p_user_id, p_amount_paid);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Referral commission failed: %', SQLERRM;
    v_commission_result := jsonb_build_object('error', SQLERRM);
  END;

  INSERT INTO goal_notifications (user_id, type, title, message, priority, metadata)
  VALUES (p_user_id, 'system_alert',
    CASE WHEN v_is_upgrade THEN 'Membership Upgraded!' ELSE 'Welcome to ' || v_pkg.name || '!' END,
    'Your ' || v_pkg.name || ' membership is active. You received ' || v_total_tokens_to_award || ' PIP tokens (cumulative tiers 1-' || v_pkg.tier_level || ').',
    'high',
    jsonb_build_object(
      'membership_id', v_membership_id,
      'tier_level', v_pkg.tier_level,
      'tokens_awarded', v_total_tokens_to_award,
      'is_upgrade', v_is_upgrade,
      'tier_breakdown', v_tier_breakdown
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'tier_level', v_pkg.tier_level,
    'tokens_awarded', v_total_tokens_to_award,
    'is_upgrade', v_is_upgrade,
    'commission_result', v_commission_result,
    'tier_breakdown', v_tier_breakdown
  );
END;
$function$;
