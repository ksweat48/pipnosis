/*
  # Create Calculate Cumulative Token Award Function

  ## Summary
  Core function for calculating cumulative tier token bonuses. This is the SSOT for
  determining which tier bonuses a user should receive based on their history and
  target tier level.

  ## Function: calculate_cumulative_token_award
  Returns detailed breakdown of token awards for a user purchasing/upgrading to a target tier.

  ## Returns JSONB
  {
    "total_tokens_to_award": 16850,
    "tier_breakdown": [
      {"tier_level": 1, "tier_name": "Member", "tokens": 100, "already_awarded": false},
      {"tier_level": 2, "tier_name": "Starter", "tokens": 250, "already_awarded": false},
      ...
    ],
    "tiers_newly_awarded": [1, 2, 3, 4, 5, 6],
    "tiers_already_awarded": [],
    "previous_tier_level": null,
    "target_tier_level": 6
  }

  ## SSOT Compliance
  - Queries club_membership_tier_history as canonical source
  - Only awards tiers not in history
  - Idempotent and deterministic

  ## CCIP Reference
  See: CUMULATIVE_TIER_TOKENS_CCIP_20260210.md - Phase 3: Function Deployment
*/

-- ============================================================
-- PART 1: Drop existing function if exists
-- ============================================================

DROP FUNCTION IF EXISTS calculate_cumulative_token_award(UUID, INTEGER);

-- ============================================================
-- PART 2: Create the cumulative token calculation function
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_cumulative_token_award(
  p_user_id UUID,
  p_target_tier_level INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_tier_breakdown JSONB[] := '{}';
  v_total_tokens NUMERIC := 0;
  v_tiers_newly_awarded INTEGER[] := '{}';
  v_tiers_already_awarded INTEGER[] := '{}';
  v_previous_tier_level INTEGER;
  v_tier_record RECORD;
BEGIN
  -- Get user's current tier level (if they have an active membership)
  SELECT tier_level INTO v_previous_tier_level
  FROM club_memberships
  WHERE user_id = p_user_id
    AND status = 'active'
  ORDER BY tier_level DESC
  LIMIT 1;

  -- Get all tier packages from 1 to target tier level
  FOR v_tier_record IN
    SELECT
      pkg.tier_level,
      pkg.name as tier_name,
      pkg.initial_token_allocation as tokens,
      EXISTS (
        SELECT 1 FROM club_membership_tier_history th
        WHERE th.user_id = p_user_id
        AND th.tier_level = pkg.tier_level
      ) as already_awarded
    FROM club_membership_packages pkg
    WHERE pkg.tier_level >= 1
      AND pkg.tier_level <= p_target_tier_level
      AND pkg.is_active = true
    ORDER BY pkg.tier_level ASC
  LOOP
    -- Build tier breakdown entry
    v_tier_breakdown := array_append(v_tier_breakdown, jsonb_build_object(
      'tier_level', v_tier_record.tier_level,
      'tier_name', v_tier_record.tier_name,
      'tokens', v_tier_record.tokens,
      'already_awarded', v_tier_record.already_awarded
    ));

    -- Track which tiers are newly awarded vs already awarded
    IF v_tier_record.already_awarded THEN
      v_tiers_already_awarded := array_append(v_tiers_already_awarded, v_tier_record.tier_level);
    ELSE
      v_tiers_newly_awarded := array_append(v_tiers_newly_awarded, v_tier_record.tier_level);
      v_total_tokens := v_total_tokens + v_tier_record.tokens;
    END IF;
  END LOOP;

  -- Build result object
  v_result := jsonb_build_object(
    'total_tokens_to_award', v_total_tokens,
    'tier_breakdown', array_to_json(v_tier_breakdown)::jsonb,
    'tiers_newly_awarded', v_tiers_newly_awarded,
    'tiers_already_awarded', v_tiers_already_awarded,
    'previous_tier_level', v_previous_tier_level,
    'target_tier_level', p_target_tier_level
  );

  RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION calculate_cumulative_token_award(UUID, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION calculate_cumulative_token_award IS
'Calculates cumulative token awards for a user purchasing/upgrading to a target tier. Returns detailed breakdown of which tier bonuses should be awarded based on club_membership_tier_history (SSOT).';

-- ============================================================
-- PART 3: Create helper function to preview upgrade benefits
-- ============================================================

CREATE OR REPLACE FUNCTION preview_upgrade_benefits(
  p_user_id UUID,
  p_target_package_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_target_tier_level INTEGER;
  v_target_package_name TEXT;
  v_target_price NUMERIC;
  v_cumulative_calculation JSONB;
  v_current_locked NUMERIC := 0;
  v_new_locked NUMERIC;
  v_locked_adjustment NUMERIC;
BEGIN
  -- Get target package details
  SELECT tier_level, name, price_usd, required_token_balance
  INTO v_target_tier_level, v_target_package_name, v_target_price, v_new_locked
  FROM club_membership_packages
  WHERE id = p_target_package_id;

  IF v_target_tier_level IS NULL THEN
    RAISE EXCEPTION 'Package not found: %', p_target_package_id;
  END IF;

  -- Get current locked tokens (if user has active membership)
  SELECT COALESCE(tokens_locked, 0) INTO v_current_locked
  FROM club_memberships
  WHERE user_id = p_user_id
    AND status = 'active'
  ORDER BY tier_level DESC
  LIMIT 1;

  -- Calculate cumulative token award
  v_cumulative_calculation := calculate_cumulative_token_award(p_user_id, v_target_tier_level);

  -- Calculate lock adjustment
  v_locked_adjustment := v_new_locked - v_current_locked;

  -- Return comprehensive preview
  RETURN jsonb_build_object(
    'package_name', v_target_package_name,
    'tier_level', v_target_tier_level,
    'price_usd', v_target_price,
    'tokens_to_receive', (v_cumulative_calculation->>'total_tokens_to_award')::NUMERIC,
    'tier_breakdown', v_cumulative_calculation->'tier_breakdown',
    'current_locked_tokens', v_current_locked,
    'new_locked_tokens', v_new_locked,
    'locked_adjustment', v_locked_adjustment,
    'net_available_increase', (v_cumulative_calculation->>'total_tokens_to_award')::NUMERIC - v_locked_adjustment
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION preview_upgrade_benefits(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION preview_upgrade_benefits IS
'Previews the benefits of upgrading to a specific package, including token awards, lock adjustments, and net available token increase.';

-- ============================================================
-- VERIFICATION QUERIES (commented for reference)
-- ============================================================

/*
-- Test fresh user buying Founder (should get all 6 tiers)
SELECT calculate_cumulative_token_award(
  '00000000-0000-0000-0000-000000000000'::uuid, -- fake user
  6 -- Founder tier
);
-- Expected: 16,850 tokens (100+250+500+1000+5000+10000)

-- Test existing Member upgrading to Builder
-- First create mock data:
-- INSERT INTO club_membership_tier_history (user_id, tier_level, tier_name, tokens_awarded, membership_id)
-- VALUES ('some-user-id', 1, 'Member', 100, 'some-membership-id');
SELECT calculate_cumulative_token_award(
  'some-user-id'::uuid,
  3 -- Builder tier
);
-- Expected: 750 tokens (250+500, excluding tier 1 already awarded)

-- Preview upgrade benefits
SELECT preview_upgrade_benefits(
  'some-user-id'::uuid,
  'some-package-id'::uuid
);
*/
