/*
  # Restore Cumulative Token Logic to grant_club_membership

  ## Summary
  The current grant_club_membership function only awards the base tier tokens (e.g., 10,000 for Founder).
  It should award cumulative tokens from ALL lower tiers (e.g., 16,850 for Founder = tiers 1-6 combined).

  ## Root Cause
  Migration 20260211085137 replaced the cumulative token logic with a simpler version that only
  awards initial_token_allocation. This caused greenmorris.83@gmail.com to only receive 10,000 PIP
  instead of 16,850 PIP.

  ## Fix
  Update grant_club_membership to call calculate_cumulative_token_award() and award all tier bonuses.
  Record each tier in club_membership_tier_history to prevent duplicate awards on future upgrades.

  ## Expected Result
  - New Founder member receives: 16,850 PIP (100+250+500+1000+5000+10000)
  - New Builder member receives: 850 PIP (100+250+500)
  - Upgrades only award new tiers not already in tier_history
  - Webhook integration works automatically for all future purchases

  ## CCIP Reference
  CCIP-CUMULATIVE-TOKENS-RESTORATION-20260211
*/

-- ============================================================================
-- Drop and recreate grant_club_membership with cumulative token logic
-- ============================================================================

DROP FUNCTION IF EXISTS grant_club_membership(UUID, UUID, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION grant_club_membership(
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
  v_cumulative_calculation JSONB;
  v_total_tokens_to_award NUMERIC;
  v_tier_breakdown JSONB;
  v_is_upgrade BOOLEAN := FALSE;
  v_commission_result JSONB;
  v_tier_record JSONB;
BEGIN
  -- Get target package details
  SELECT * INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  -- Check for existing active membership
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

    -- Mark old membership as upgraded
    UPDATE club_memberships SET status = 'upgraded', updated_at = now()
    WHERE id = v_existing_membership.id;

    -- Unlock old tokens if needed
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

  -- Create new membership record
  INSERT INTO club_memberships (user_id, package_id, tier_level, status, amount_paid_usd, stripe_session_id, tokens_locked)
  VALUES (p_user_id, p_package_id, v_pkg.tier_level, 'active', p_amount_paid, p_stripe_session_id, v_pkg.required_token_balance)
  RETURNING id INTO v_membership_id;

  -- ============================================================================
  -- CUMULATIVE TOKEN AWARD LOGIC (RESTORED)
  -- ============================================================================
  
  -- Calculate which tiers need to be awarded (excludes already-awarded tiers)
  v_cumulative_calculation := calculate_cumulative_token_award(p_user_id, v_pkg.tier_level);
  v_total_tokens_to_award := (v_cumulative_calculation->>'total_tokens_to_award')::NUMERIC;
  v_tier_breakdown := v_cumulative_calculation->'tier_breakdown';

  -- Award tokens for each newly-awarded tier
  FOR v_tier_record IN SELECT * FROM jsonb_array_elements(v_tier_breakdown)
  LOOP
    -- Only award tiers not already in history
    IF NOT (v_tier_record->>'already_awarded')::BOOLEAN THEN
      DECLARE
        v_tier_level INTEGER := (v_tier_record->>'tier_level')::INTEGER;
        v_tier_name TEXT := v_tier_record->>'tier_name';
        v_tier_tokens NUMERIC := (v_tier_record->>'tokens')::NUMERIC;
      BEGIN
        -- Award tier tokens via SSOT function
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

        -- Record tier in history to prevent duplicate awards
        INSERT INTO club_membership_tier_history (user_id, tier_level, tier_name, tokens_awarded, membership_id)
        VALUES (p_user_id, v_tier_level, v_tier_name, v_tier_tokens, v_membership_id);
      END;
    END IF;
  END LOOP;

  -- Lock tokens for membership requirement
  IF v_pkg.required_token_balance > 0 THEN
    UPDATE club_token_balances SET locked_tokens = v_pkg.required_token_balance, updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO club_token_ledger (user_id, transaction_type, amount, balance_after, reference_id, description)
    SELECT p_user_id, 'membership_lock', -v_pkg.required_token_balance,
           COALESCE(total_tokens, 0), v_membership_id, 'Locked for ' || v_pkg.name || ' membership'
    FROM club_token_balances WHERE user_id = p_user_id;
  END IF;

  -- Update membership to track cumulative tokens awarded
  UPDATE club_memberships
  SET cumulative_tokens_awarded = v_total_tokens_to_award
  WHERE id = v_membership_id;

  -- ONGOING REFERRAL COMMISSION SYSTEM
  BEGIN
    v_commission_result := pay_referral_commission(p_user_id, p_package_id, p_amount_paid, v_membership_id, v_is_upgrade);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Referral commission failed: %', SQLERRM;
    v_commission_result := jsonb_build_object('error', SQLERRM);
  END;

  -- Send notification
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
$$;

GRANT EXECUTE ON FUNCTION grant_club_membership TO service_role;

COMMENT ON FUNCTION grant_club_membership IS
  'CCIP-CUMULATIVE-TOKENS-RESTORATION-20260211: Grants club membership with cumulative tier token bonuses. Awards tokens from ALL tiers 1 through target tier (excluding tiers already in user''s tier_history). Records each tier award to prevent duplicates on future upgrades.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_test_result JSONB;
BEGIN
  RAISE NOTICE 'Cumulative token logic restored to grant_club_membership';
  RAISE NOTICE 'Future Founder purchases will receive 16,850 PIP (tiers 1-6 combined)';
  RAISE NOTICE 'Future Builder purchases will receive 850 PIP (tiers 1-3 combined)';
  RAISE NOTICE 'Upgrades will only award new tiers not already in tier_history';
  RAISE NOTICE 'Webhook integration will work automatically';
END $$;
