/*
  # Refactor grant_club_membership for Cumulative Token System

  ## Summary
  Transforms the membership granting function to award cumulative tier bonuses instead
  of single-tier allocations. This is the core business logic change enabling the
  cumulative progression system.

  ## Key Changes
  1. Allows upgrades (removes "already has membership" blocker)
  2. Calls calculate_cumulative_token_award for proper bonus calculation
  3. Awards tokens from ALL tiers user passes through
  4. Inserts tier history records for each awarded tier
  5. Handles lock token adjustments for upgrades
  6. Maintains referral reward logic
  7. Updates notifications with cumulative bonus details

  ## Business Logic
  - Fresh user buying Founder: Gets 16,850 tokens (sum of all 6 tiers)
  - Member upgrading to Builder: Gets 750 tokens (Starter + Builder only)
  - Previous locked tokens immediately become available on upgrade
  - New tier requirement locks appropriate amount

  ## SSOT Compliance
  - Uses calculate_cumulative_token_award as authority for token amounts
  - Records tier history for each awarded tier (immutable)
  - Maintains ledger entries for full audit trail
  - Updates club_token_balances as canonical balance source

  ## CCIP Reference
  See: CUMULATIVE_TIER_TOKENS_CCIP_20260210.md - Phase 3: Function Deployment
*/

-- ============================================================
-- Drop and recreate the function with cumulative logic
-- ============================================================

DROP FUNCTION IF EXISTS grant_club_membership(UUID, UUID, TEXT, TEXT, NUMERIC);

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
  v_existing_membership RECORD;
  v_membership_id UUID;
  v_balance RECORD;
  v_new_available NUMERIC(12,2);
  v_referral RECORD;
  
  -- Cumulative token calculation variables
  v_cumulative_calc JSONB;
  v_total_tokens_to_award NUMERIC(12,2);
  v_tier_breakdown JSONB;
  v_tiers_newly_awarded INTEGER[];
  v_previous_tier_level INTEGER;
  v_previous_locked NUMERIC(12,2) := 0;
  v_lock_adjustment NUMERIC(12,2);
  
  -- Loop variables for tier history
  v_tier_entry JSONB;
  v_tier_level INTEGER;
  v_tier_name TEXT;
  v_tier_tokens NUMERIC(12,2);
  v_tier_already_awarded BOOLEAN;
  v_is_upgrade BOOLEAN := false;
  v_previous_membership_id UUID;
BEGIN
  -- Validate package exists and is active
  SELECT * INTO v_pkg
  FROM club_membership_packages
  WHERE id = p_package_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found or inactive');
  END IF;

  -- Check if user has an existing active membership (for upgrade detection)
  SELECT id, tier_level, tokens_locked INTO v_existing_membership
  FROM club_memberships
  WHERE user_id = p_user_id AND status = 'active'
  ORDER BY tier_level DESC
  LIMIT 1;

  IF FOUND THEN
    -- This is an upgrade
    v_is_upgrade := true;
    v_previous_membership_id := v_existing_membership.id;
    v_previous_tier_level := v_existing_membership.tier_level;
    v_previous_locked := v_existing_membership.tokens_locked;
    
    -- Validate upgrade is to a higher tier
    IF v_pkg.tier_level <= v_previous_tier_level THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cannot downgrade or purchase same tier. Current tier: ' || v_previous_tier_level || ', Target tier: ' || v_pkg.tier_level
      );
    END IF;
    
    -- Mark old membership as upgraded
    UPDATE club_memberships
    SET status = 'upgraded',
        updated_at = NOW()
    WHERE id = v_previous_membership_id;
  END IF;

  -- Calculate cumulative token award using SSOT function
  v_cumulative_calc := calculate_cumulative_token_award(p_user_id, v_pkg.tier_level);
  v_total_tokens_to_award := (v_cumulative_calc->>'total_tokens_to_award')::NUMERIC(12,2);
  v_tier_breakdown := v_cumulative_calc->'tier_breakdown';
  v_tiers_newly_awarded := ARRAY(
    SELECT jsonb_array_elements_text(v_cumulative_calc->'tiers_newly_awarded')::INTEGER
  );

  -- Validate there are tokens to award
  IF v_total_tokens_to_award <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No new tier bonuses to award. All tiers have already been granted.'
    );
  END IF;

  -- Create new membership record
  INSERT INTO club_memberships (
    user_id, package_id, tier_level, status,
    purchased_at, activated_at,
    stripe_session_id, stripe_payment_intent_id,
    amount_paid_usd, tokens_locked,
    is_upgrade, previous_membership_id, previous_tier_level,
    cumulative_tokens_awarded
  ) VALUES (
    p_user_id, p_package_id, v_pkg.tier_level, 'active',
    NOW(), NOW(),
    p_stripe_session_id, p_stripe_payment_intent_id,
    p_amount_paid_usd, v_pkg.required_token_balance,
    v_is_upgrade, v_previous_membership_id, v_previous_tier_level,
    v_total_tokens_to_award
  ) RETURNING id INTO v_membership_id;

  -- Ensure token balance record exists
  INSERT INTO club_token_balances (
    user_id, total_tokens, locked_tokens, staked_tokens, lifetime_earned, lifetime_spent
  ) VALUES (
    p_user_id, 0, 0, 0, 0, 0
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Award cumulative tokens
  UPDATE club_token_balances
  SET total_tokens = total_tokens + v_total_tokens_to_award,
      lifetime_earned = lifetime_earned + v_total_tokens_to_award,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Handle lock token adjustment
  v_lock_adjustment := v_pkg.required_token_balance - v_previous_locked;
  
  UPDATE club_token_balances
  SET locked_tokens = locked_tokens + v_lock_adjustment,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Get final available balance
  SELECT (total_tokens - locked_tokens) INTO v_new_available
  FROM club_token_balances WHERE user_id = p_user_id;

  -- Insert ledger entries for each tier awarded (detailed audit trail)
  FOR v_tier_entry IN SELECT jsonb_array_elements(v_tier_breakdown)
  LOOP
    v_tier_level := (v_tier_entry->>'tier_level')::INTEGER;
    v_tier_name := v_tier_entry->>'tier_name';
    v_tier_tokens := (v_tier_entry->>'tokens')::NUMERIC(12,2);
    v_tier_already_awarded := (v_tier_entry->>'already_awarded')::BOOLEAN;
    
    -- Only log and record tier if it's newly awarded
    IF NOT v_tier_already_awarded THEN
      -- Insert tier history record (SSOT for awarded tiers)
      INSERT INTO club_membership_tier_history (
        user_id, tier_level, tier_name, tokens_awarded,
        membership_id, awarded_at
      ) VALUES (
        p_user_id, v_tier_level, v_tier_name, v_tier_tokens,
        v_membership_id, NOW()
      );
      
      -- Insert ledger entry for this tier bonus
      INSERT INTO club_token_ledger (
        user_id, transaction_type, amount, balance_after,
        description, reference_id, reference_type
      ) VALUES (
        p_user_id, 'tier_bonus', v_tier_tokens,
        (SELECT total_tokens FROM club_token_balances WHERE user_id = p_user_id),
        'Tier ' || v_tier_level || ' bonus: ' || v_tier_tokens || ' PIP (' || v_tier_name || ')',
        v_membership_id, 'membership'
      );
    END IF;
  END LOOP;

  -- Insert ledger entry for lock adjustment
  IF v_lock_adjustment != 0 THEN
    INSERT INTO club_token_ledger (
      user_id, transaction_type, amount, balance_after,
      description, reference_id, reference_type
    ) VALUES (
      p_user_id, 'membership_lock_adjustment', -ABS(v_lock_adjustment),
      v_new_available,
      CASE
        WHEN v_is_upgrade THEN 'Lock adjustment: ' || v_lock_adjustment || ' PIP (upgrade to ' || v_pkg.name || ')'
        ELSE 'Locked ' || v_pkg.required_token_balance || ' PIP for ' || v_pkg.name || ' membership'
      END,
      v_membership_id, 'membership'
    );
  END IF;

  -- Handle referral rewards (only for new purchases, not upgrades)
  IF NOT v_is_upgrade THEN
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
        v_referral.id, 'referral'
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
  END IF;

  -- Create notification with cumulative bonus details
  INSERT INTO goal_notifications (
    user_id, type, priority, title, message, metadata
  ) VALUES (
    p_user_id, 'system_alert', 'high',
    CASE
      WHEN v_is_upgrade THEN 'Membership Upgraded!'
      ELSE 'Welcome to Pipnosis Club!'
    END,
    CASE
      WHEN v_is_upgrade THEN
        'You upgraded to ' || v_pkg.name || ' and received ' || v_total_tokens_to_award || ' PIP tokens from ' || array_length(v_tiers_newly_awarded, 1) || ' tier bonuses. ' || v_new_available || ' PIP now available.'
      ELSE
        'Your ' || v_pkg.name || ' membership is active! You received ' || v_total_tokens_to_award || ' PIP tokens from ' || array_length(v_tiers_newly_awarded, 1) || ' tier bonuses. ' || v_new_available || ' PIP available.'
    END,
    jsonb_build_object(
      'membership_id', v_membership_id,
      'package_name', v_pkg.name,
      'tier_level', v_pkg.tier_level,
      'total_tokens_awarded', v_total_tokens_to_award,
      'tokens_locked', v_pkg.required_token_balance,
      'tokens_available', v_new_available,
      'tiers_awarded_count', array_length(v_tiers_newly_awarded, 1),
      'tiers_awarded', v_tiers_newly_awarded,
      'is_upgrade', v_is_upgrade,
      'previous_tier_level', v_previous_tier_level,
      'amount_paid', p_amount_paid_usd,
      'stripe_session_id', p_stripe_session_id
    )
  );

  -- Return success with comprehensive details
  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'tier_level', v_pkg.tier_level,
    'tier_name', v_pkg.name,
    'total_tokens_awarded', v_total_tokens_to_award,
    'tokens_locked', v_pkg.required_token_balance,
    'tokens_available', v_new_available,
    'tiers_awarded_count', array_length(v_tiers_newly_awarded, 1),
    'tiers_awarded', v_tiers_newly_awarded,
    'is_upgrade', v_is_upgrade,
    'previous_tier_level', v_previous_tier_level,
    'tier_breakdown', v_tier_breakdown
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION grant_club_membership(UUID, UUID, TEXT, TEXT, NUMERIC) TO service_role;

COMMENT ON FUNCTION grant_club_membership IS
'Grants or upgrades club membership with cumulative tier token bonuses. Awards tokens from ALL tiers user passes through. Handles upgrades by unlocking previous tier and locking new tier tokens. Creates tier history records for audit trail.';
