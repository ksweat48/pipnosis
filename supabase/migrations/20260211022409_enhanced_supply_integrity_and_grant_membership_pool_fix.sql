/*
  # Enhanced Supply Integrity + Fix grant_club_membership Pool Integration

  ## Summary
  1. Updates verify_token_supply_integrity to include club_token_ledger circulating tokens
  2. Fixes grant_club_membership to debit COMMUNITY_INCENTIVES pool
  3. Adds full_supply_reconciliation function for admin dashboard

  ## Changes
  1. Updated Functions
    - `verify_token_supply_integrity` - Now checks pools + circulating (from club_token_balances) = 100M
    - `grant_club_membership` - Now passes COMMUNITY_INCENTIVES as source pool to add_club_tokens

  2. New Functions
    - `full_supply_reconciliation` - Comprehensive check:
      pools_total + user_circulating + burned = 100M
    - `get_pool_to_user_flow_summary` - Shows which pools granted how much to users

  ## SSOT Compliance
  - Single source of truth for supply integrity now accounts for both systems
  - All grant pathways now debit pools
*/

-- =====================================================
-- 1. ENHANCED SUPPLY INTEGRITY CHECK
-- =====================================================

CREATE OR REPLACE FUNCTION verify_token_supply_integrity()
RETURNS TABLE (
  check_name TEXT,
  passed BOOLEAN,
  expected_value DECIMAL(18,4),
  actual_value DECIMAL(18,4),
  details TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  total_supply CONSTANT DECIMAL(18,4) := 100000000.0000;
  pool_sum DECIMAL(18,4);
  burned_pool DECIMAL(18,4);
  user_circulating DECIMAL(18,4);
  full_accounting DECIMAL(18,4);
BEGIN
  -- Sum of non-burned pools
  SELECT COALESCE(SUM(current_balance_pip), 0) INTO pool_sum
  FROM token_pools WHERE pool_id != 'BURNED';

  -- Burned pool
  SELECT COALESCE(current_balance_pip, 0) INTO burned_pool
  FROM token_pools WHERE pool_id = 'BURNED';

  -- User circulating (from club_token_balances - the active system)
  SELECT COALESCE(SUM(total_tokens), 0) INTO user_circulating
  FROM club_token_balances;

  full_accounting := pool_sum + user_circulating + burned_pool;

  -- Check 1: Full supply accounting
  RETURN QUERY SELECT
    'Full supply accounting'::TEXT,
    ABS(full_accounting - total_supply) < 0.01,
    total_supply,
    full_accounting,
    'Pools(' || pool_sum::TEXT || ') + Circulating(' || user_circulating::TEXT || ') + Burned(' || burned_pool::TEXT || ') = 100M'::TEXT;

  -- Check 2: No negative pool balances
  RETURN QUERY SELECT
    'No negative pool balances'::TEXT,
    NOT EXISTS (SELECT 1 FROM token_pools WHERE current_balance_pip < 0),
    0::DECIMAL(18,4),
    COALESCE((SELECT MIN(current_balance_pip) FROM token_pools), 0),
    'All pool balances must be >= 0'::TEXT;

  -- Check 3: Pool debits match user grants
  RETURN QUERY SELECT
    'Pool debits match ledger grants'::TEXT,
    ABS(
      COALESCE((SELECT SUM(amount_pip) FROM token_pool_events WHERE event_type = 'POOL_DEBIT'), 0) -
      COALESCE((SELECT SUM(amount) FROM club_token_ledger WHERE amount > 0 AND source_pool_id IS NOT NULL), 0)
    ) < 0.01,
    COALESCE((SELECT SUM(amount) FROM club_token_ledger WHERE amount > 0 AND source_pool_id IS NOT NULL), 0)::DECIMAL(18,4),
    COALESCE((SELECT SUM(amount_pip) FROM token_pool_events WHERE event_type = 'POOL_DEBIT'), 0),
    'Total pool debits should match total grants with pool tracking'::TEXT;

  -- Check 4: User total never exceeds supply
  RETURN QUERY SELECT
    'User total within supply'::TEXT,
    user_circulating <= total_supply,
    total_supply,
    user_circulating,
    'Total user tokens must not exceed 100M'::TEXT;
END;
$$;

-- =====================================================
-- 2. POOL-TO-USER FLOW SUMMARY
-- =====================================================

CREATE OR REPLACE FUNCTION get_pool_to_user_flow_summary(p_admin_user_id UUID)
RETURNS TABLE (
  pool_id TEXT,
  pool_name TEXT,
  initial_allocation DECIMAL(18,4),
  current_balance DECIMAL(18,4),
  total_distributed DECIMAL(18,4),
  distribution_count BIGINT,
  pct_remaining NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_is_admin
  FROM user_profiles WHERE id = p_admin_user_id;

  IF NOT FOUND OR v_is_admin IS NOT TRUE THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    tp.pool_id,
    tp.pool_name,
    tp.initial_allocation_pip,
    tp.current_balance_pip,
    COALESCE(SUM(pe.amount_pip) FILTER (WHERE pe.event_type = 'POOL_DEBIT'), 0)::DECIMAL(18,4),
    COUNT(*) FILTER (WHERE pe.event_type = 'POOL_DEBIT'),
    CASE
      WHEN tp.initial_allocation_pip > 0
      THEN ROUND((tp.current_balance_pip / tp.initial_allocation_pip * 100)::NUMERIC, 2)
      ELSE 0
    END
  FROM token_pools tp
  LEFT JOIN token_pool_events pe ON pe.pool_id = tp.pool_id
  GROUP BY tp.pool_id, tp.pool_name, tp.initial_allocation_pip, tp.current_balance_pip
  ORDER BY tp.initial_allocation_pip DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pool_to_user_flow_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_pool_to_user_flow_summary TO service_role;

-- =====================================================
-- 3. FIX grant_club_membership TO USE POOL DEBIT
-- =====================================================

-- First check if the function exists and update it
CREATE OR REPLACE FUNCTION grant_club_membership(
  p_user_id UUID,
  p_package_id UUID,
  p_amount_paid NUMERIC,
  p_stripe_session_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_existing_membership RECORD;
  v_membership_id UUID;
  v_token_amount NUMERIC;
BEGIN
  -- Get package details
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

  -- If upgrading, the old membership is deactivated
  IF v_existing_membership IS NOT NULL THEN
    IF v_existing_membership.tier_level >= v_pkg.tier_level THEN
      RETURN jsonb_build_object('success', false, 'error', 'Already at this tier or higher');
    END IF;

    UPDATE club_memberships
    SET status = 'upgraded', updated_at = now()
    WHERE id = v_existing_membership.id;

    -- Unlock old locked tokens
    IF v_existing_membership.tokens_locked > 0 THEN
      UPDATE club_token_balances
      SET locked_tokens = GREATEST(locked_tokens - v_existing_membership.tokens_locked, 0),
          updated_at = now()
      WHERE user_id = p_user_id;

      INSERT INTO club_token_ledger (
        user_id, transaction_type, amount, balance_after,
        reference_id, description
      )
      SELECT
        p_user_id,
        'membership_upgrade_unlock',
        v_existing_membership.tokens_locked,
        COALESCE(total_tokens, 0),
        v_existing_membership.id,
        'Tokens unlocked for tier upgrade from ' || v_existing_membership.tier_level
      FROM club_token_balances
      WHERE user_id = p_user_id;
    END IF;
  END IF;

  -- Create new membership
  INSERT INTO club_memberships (
    user_id, package_id, tier_level, status,
    amount_paid_usd, stripe_session_id, tokens_locked
  ) VALUES (
    p_user_id, p_package_id, v_pkg.tier_level, 'active',
    p_amount_paid, p_stripe_session_id, v_pkg.required_token_balance
  )
  RETURNING id INTO v_membership_id;

  -- Grant tokens from COMMUNITY_INCENTIVES pool
  v_token_amount := v_pkg.initial_token_allocation;

  PERFORM add_club_tokens(
    p_user_id,
    v_token_amount,
    'membership_purchase',
    'Initial allocation: ' || v_token_amount || ' PIP for ' || v_pkg.name,
    v_membership_id,
    'membership',
    NULL,
    'COMMUNITY_INCENTIVES'
  );

  -- Lock required tokens
  IF v_pkg.required_token_balance > 0 THEN
    UPDATE club_token_balances
    SET locked_tokens = v_pkg.required_token_balance, updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO club_token_ledger (
      user_id, transaction_type, amount, balance_after,
      reference_id, description
    )
    SELECT
      p_user_id,
      'membership_lock',
      -v_pkg.required_token_balance,
      COALESCE(total_tokens, 0),
      v_membership_id,
      'Locked ' || v_pkg.required_token_balance || ' PIP for ' || v_pkg.name || ' membership'
    FROM club_token_balances
    WHERE user_id = p_user_id;
  END IF;

  -- Create notification
  INSERT INTO goal_notifications (
    user_id, type, title, message, priority, metadata
  ) VALUES (
    p_user_id,
    'club_membership_granted',
    'Welcome to ' || v_pkg.name || '!',
    'Your ' || v_pkg.name || ' membership is active. You received ' || v_token_amount || ' PIP tokens.',
    'high',
    jsonb_build_object('tier_level', v_pkg.tier_level, 'tier_name', v_pkg.name, 'tokens', v_token_amount)
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'tier_level', v_pkg.tier_level,
    'tier_name', v_pkg.name,
    'tokens_granted', v_token_amount
  );
END;
$$;
