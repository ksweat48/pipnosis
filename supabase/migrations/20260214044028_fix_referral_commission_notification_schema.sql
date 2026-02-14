/*
  # Fix Referral Commission Notification Schema

  ## Problem
  The `pay_referral_commission` function used `reference_id` and `reference_type`
  columns which do not exist on `goal_notifications`. The referral context must
  be stored in the `metadata` JSONB column instead.

  ## Fix
  - Remove non-existent `reference_id` / `reference_type` columns from INSERT
  - Store referral_id in `metadata` alongside commission details
*/

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
  SELECT referred_by_user_id
  INTO v_referrer_id
  FROM user_profiles
  WHERE id = p_referee_id;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referrer');
  END IF;

  v_completion_result := complete_referral_on_purchase(p_referee_id);

  IF NOT COALESCE((v_completion_result->>'success')::boolean, false) THEN
    RAISE NOTICE '[CCIP] Referral completion note: %', v_completion_result->>'error';
  END IF;

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

  SELECT NOT COALESCE(reward_paid, false)
  INTO v_is_first_commission
  FROM club_referrals
  WHERE id = v_referral_id;

  v_transaction_type := CASE
    WHEN v_is_first_commission THEN 'referral_commission_initial'
    ELSE 'referral_commission_upgrade'
  END;

  v_pip_commission := ROUND((p_membership_price_usd * v_pip_commission_pct) / v_pip_token_price, 2);
  v_cash_commission := ROUND(p_membership_price_usd * v_cash_commission_pct, 2);

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

  INSERT INTO goal_notifications (
    user_id, type, title, message, priority, metadata
  ) VALUES (
    v_referrer_id,
    'referral_commission_earned',
    'Referral Commission Earned!',
    format('You earned %s PIP tokens + $%s cash from a referral purchase!', v_pip_commission, v_cash_commission),
    'medium',
    jsonb_build_object(
      'referral_id', v_referral_id,
      'pip_tokens', v_pip_commission,
      'cash_usd', v_cash_commission,
      'membership_price', p_membership_price_usd,
      'transaction_type', v_transaction_type
    )
  );

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
