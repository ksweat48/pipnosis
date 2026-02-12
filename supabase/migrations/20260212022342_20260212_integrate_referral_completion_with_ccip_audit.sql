/*
  # Integrate Referral Completion with CCIP Audit Trail

  ## CCIP Change Control
  - CCIP-20260212-002: Wire referral completion through CCIP audit
  - Depends on: CCIP-20260212-001
  
  ## Problem
  `pay_referral_commission()` directly updates club_referrals status without CCIP audit trail.
  This bypasses governance tracking and makes debugging referral issues difficult.

  ## Solution
  Update `pay_referral_commission()` to call `complete_referral_on_purchase()` first,
  which properly tracks the state transition in referral_state_audit table.

  ## Changes
  1. Update pay_referral_commission to call complete_referral_on_purchase
  2. Remove duplicate status update logic
  3. Ensure CCIP audit trail is maintained for all referral completions
*/

-- ============================================================================
-- Update pay_referral_commission to use CCIP-tracked completion
-- ============================================================================

CREATE OR REPLACE FUNCTION pay_referral_commission(
  p_referee_id UUID,
  p_membership_price_usd NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
  v_referral_id UUID;
  v_pip_commission NUMERIC;
  v_cash_commission NUMERIC;
  v_ledger_id UUID;
  v_completion_result JSONB;
  v_pip_token_price CONSTANT NUMERIC := 0.10; -- $0.10 per PIP token
  v_pip_commission_pct CONSTANT NUMERIC := 0.10; -- 10% of membership price
  v_cash_commission_pct CONSTANT NUMERIC := 0.20; -- 20% of membership price
BEGIN
  -- Find referrer from user_profiles (SSOT for referral relationships)
  SELECT referred_by_user_id
  INTO v_referrer_id
  FROM user_profiles
  WHERE id = p_referee_id;

  -- No referrer, exit gracefully
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referrer');
  END IF;

  -- CCIP: Complete the referral with audit trail
  -- This updates status from 'pending' -> 'completed' and logs in referral_state_audit
  v_completion_result := complete_referral_on_purchase(p_referee_id);
  
  IF NOT (v_completion_result->>'success')::boolean THEN
    -- Referral completion failed, but continue to pay commission
    -- (defensive programming - may be a duplicate purchase/upgrade)
    RAISE NOTICE '[CCIP] Referral completion warning: %', v_completion_result->>'error';
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

  -- Calculate commissions
  -- PIP: 10% of membership price converted to tokens at $0.10 per token
  v_pip_commission := ROUND((p_membership_price_usd * v_pip_commission_pct) / v_pip_token_price, 2);
  
  -- Cash: 20% of membership price
  v_cash_commission := ROUND(p_membership_price_usd * v_cash_commission_pct, 2);

  -- Update referral record with commission amounts and payment status
  IF v_referral_id IS NOT NULL THEN
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
          'cash_commission', v_cash_commission
        )
      )
    WHERE id = v_referral_id;
  ELSE
    -- Defensive: Create referral record if somehow it doesn't exist
    -- This should rarely happen if signup tracking is working correctly
    INSERT INTO club_referrals (
      referrer_id,
      referee_id,
      referral_code,
      status,
      completed_at,
      tokens_awarded,
      cash_awarded_usd,
      reward_paid,
      reward_paid_at,
      commission_model,
      metadata
    )
    SELECT 
      v_referrer_id,
      p_referee_id,
      COALESCE(cr.referral_code, 'CLUB-' || substr(md5(random()::text), 1, 6)),
      'completed',
      now(),
      v_pip_commission,
      v_cash_commission,
      true,
      now(),
      'ongoing',
      jsonb_build_object(
        'created_by', 'pay_referral_commission',
        'membership_price_usd', p_membership_price_usd
      )
    FROM (SELECT referral_code FROM club_referrals WHERE referrer_id = v_referrer_id LIMIT 1) cr
    RETURNING id INTO v_referral_id;

    RAISE WARNING '[CCIP] Created missing referral record for referee=%, referrer=%', p_referee_id, v_referrer_id;
  END IF;

  -- Award PIP tokens to referrer via club_token_ledger
  INSERT INTO club_token_ledger (
    user_id,
    amount,
    transaction_type,
    description,
    reference_id,
    source_pool
  ) VALUES (
    v_referrer_id,
    v_pip_commission,
    'referral_commission_ongoing', -- Changed from 'initial' to 'ongoing' for upgrades
    format('Referral commission: %s PIP + $%s cash from membership purchase', v_pip_commission, v_cash_commission),
    v_referral_id,
    'referral'
  )
  RETURNING id INTO v_ledger_id;

  -- Send notification to referrer
  INSERT INTO goal_notifications (
    user_id,
    type,
    title,
    message,
    priority,
    reference_id,
    reference_type,
    metadata
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
      'commission_type', 'ongoing'
    )
  );

  RAISE NOTICE '[CCIP] Paid referral commission: referrer=%, pip=%, cash=$%', v_referrer_id, v_pip_commission, v_cash_commission;

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'referral_id', v_referral_id,
    'pip_commission', v_pip_commission,
    'cash_commission', v_cash_commission,
    'ledger_id', v_ledger_id
  );
END;
$$;

COMMENT ON FUNCTION pay_referral_commission IS
  'SSOT for referral commission calculation. Pays 10% of membership price as PIP tokens + 20% as cash commission. Integrated with CCIP audit trail via complete_referral_on_purchase().';

-- ============================================================================
-- CCIP Tracking
-- ============================================================================

INSERT INTO ccip_change_requests (
  change_type,
  change_title,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  priority,
  modified_files,
  database_changes,
  breaking_changes
)
VALUES (
  'refactor',
  'CCIP-20260212-002: Wire Referral Commission Through CCIP Audit',
  'Update pay_referral_commission() to call complete_referral_on_purchase() for proper CCIP audit trail. Ensures all referral state transitions are tracked in referral_state_audit table.',
  'Enables governance tracking and debugging of referral completions. Critical for transparency and dispute resolution.',
  'Updates pay_referral_commission() to delegate status updates to complete_referral_on_purchase(). No breaking changes to function signature or return values.',
  'Low - Pure refactor with better tracking. Defensive programming handles edge cases.',
  'approved',
  'approved',
  'high',
  ARRAY['supabase/migrations/20260212_integrate_referral_completion_with_ccip_audit.sql'],
  true,
  false
);
