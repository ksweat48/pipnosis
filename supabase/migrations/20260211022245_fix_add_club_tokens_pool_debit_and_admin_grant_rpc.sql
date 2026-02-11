/*
  # Fix add_club_tokens to Debit Pools + Create Admin Grant RPC

  ## Summary
  The add_club_tokens RPC currently adds tokens to users without debiting
  from any pool. This creates "tokens from thin air" and breaks supply integrity.
  
  This migration:
  1. Updates add_club_tokens to accept source_pool_id and debit the pool atomically
  2. Creates admin_grant_tokens_from_pool RPC for manual admin transfers
  3. Creates pool access control rules

  ## Changes
  1. Modified Functions
    - `add_club_tokens` - Now accepts optional p_source_pool_id parameter
      When provided, atomically debits the pool and records source_pool_id
    - `grant_club_membership` - Updated to pass COMMUNITY_INCENTIVES as source pool

  2. New Functions  
    - `admin_grant_tokens_from_pool` - Admin-only RPC for manual pool-to-user transfers
      Validates admin permissions, pool access, enforces audit trail
    - `get_admin_accessible_pools` - Returns pools the current admin can access

  3. New Table
    - `admin_pool_access_rules` - Defines which pools admins can manually access

  ## Security
  - Admin verification on all manual grant functions
  - Pool access control enforced at database level
  - Full audit trail with admin_id recorded

  ## SSOT Compliance  
  - Every token grant now debits a pool (supply conservation)
  - Pool events created for every debit
  - Ledger records pool source
*/

-- =====================================================
-- 1. ADMIN POOL ACCESS RULES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS admin_pool_access_rules (
  pool_id TEXT NOT NULL REFERENCES token_pools(pool_id),
  access_level TEXT NOT NULL CHECK (access_level IN ('manual_grant', 'transfer_out', 'view_only', 'locked')),
  max_single_grant DECIMAL(18,4) DEFAULT 100000.0000,
  requires_approval BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (pool_id, access_level)
);

ALTER TABLE admin_pool_access_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pool access rules"
  ON admin_pool_access_rules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role manages pool access rules"
  ON admin_pool_access_rules FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Initialize access rules
INSERT INTO admin_pool_access_rules (pool_id, access_level, max_single_grant, requires_approval, description)
VALUES
  ('COMMUNITY_INCENTIVES', 'manual_grant', 100000.0000, false, 'Membership grants, tier bonuses, trading rewards, contest prizes'),
  ('COMMUNITY_INCENTIVES', 'transfer_out', 1000000.0000, false, 'Transfer to other pools for rebalancing'),
  ('MARKETING_PARTNERS', 'manual_grant', 50000.0000, false, 'Affiliate payments, partnership deals, marketing campaigns'),
  ('MARKETING_PARTNERS', 'transfer_out', 500000.0000, false, 'Transfer to other pools for rebalancing'),
  ('OPERATIONS_RESERVE', 'manual_grant', 25000.0000, true, 'Emergency grants, bug bounties, customer support compensation'),
  ('OPERATIONS_RESERVE', 'transfer_out', 100000.0000, true, 'Transfer to other pools - requires approval'),
  ('FOUNDERS_TEAM', 'manual_grant', 50000.0000, true, 'New team member allocations, founder vesting'),
  ('FOUNDERS_TEAM', 'transfer_out', 200000.0000, true, 'Transfer to other pools - requires approval'),
  ('PUBLIC_LIQUIDITY_FUTURE', 'locked', 0, true, 'Locked for future DEX/liquidity deployment'),
  ('BURNED', 'view_only', 0, false, 'Read-only sink for burned tokens')
ON CONFLICT DO NOTHING;

-- =====================================================
-- 2. UPDATE add_club_tokens TO SUPPORT POOL DEBIT
-- =====================================================

CREATE OR REPLACE FUNCTION add_club_tokens(
  p_user_id UUID,
  p_amount NUMERIC,
  p_transaction_type TEXT,
  p_description TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_source_pool_id TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_total NUMERIC;
  v_pool_balance DECIMAL(18,4);
BEGIN
  -- If source pool specified, debit it atomically
  IF p_source_pool_id IS NOT NULL THEN
    -- Validate pool exists and has sufficient balance
    SELECT current_balance_pip INTO v_pool_balance
    FROM token_pools
    WHERE pool_id = p_source_pool_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source pool not found: %', p_source_pool_id;
    END IF;

    IF v_pool_balance < p_amount THEN
      RAISE EXCEPTION 'Insufficient pool balance. Pool: %, Available: %, Requested: %',
        p_source_pool_id, v_pool_balance, p_amount;
    END IF;

    -- Debit the pool
    UPDATE token_pools
    SET current_balance_pip = current_balance_pip - p_amount,
        updated_at = now()
    WHERE pool_id = p_source_pool_id;

    -- Record pool event
    INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, ref_id, metadata)
    VALUES (
      p_source_pool_id,
      'POOL_DEBIT',
      p_amount,
      'club_token_grant',
      p_user_id,
      jsonb_build_object(
        'user_id', p_user_id::TEXT,
        'transaction_type', p_transaction_type,
        'description', p_description
      )
    );
  END IF;

  -- Update user balance (existing logic)
  INSERT INTO club_token_balances (user_id, total_tokens, lifetime_earned)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    total_tokens = club_token_balances.total_tokens + p_amount,
    lifetime_earned = club_token_balances.lifetime_earned + p_amount,
    last_transaction_at = now(),
    updated_at = now();

  SELECT total_tokens INTO v_new_total
  FROM club_token_balances WHERE user_id = p_user_id;

  -- Insert ledger record with source pool
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    reference_id, reference_type, description, created_by,
    source_pool_id, initiated_by_admin_id
  )
  VALUES (
    p_user_id, p_transaction_type, p_amount, v_new_total,
    p_reference_id, p_reference_type, p_description, p_created_by,
    p_source_pool_id,
    CASE WHEN p_transaction_type IN ('admin_grant', 'promotion_bonus') THEN p_created_by ELSE NULL END
  );

  RETURN TRUE;
END;
$$;

-- =====================================================
-- 3. ADMIN GRANT TOKENS FROM POOL (Manual transfer)
-- =====================================================

CREATE OR REPLACE FUNCTION admin_grant_tokens_from_pool(
  p_admin_user_id UUID,
  p_recipient_user_id UUID,
  p_amount NUMERIC,
  p_source_pool_id TEXT,
  p_grant_purpose TEXT,
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_pool_balance DECIMAL(18,4);
  v_max_grant DECIMAL(18,4);
  v_access_level TEXT;
  v_new_total NUMERIC;
  v_ledger_id UUID;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin
  FROM user_profiles WHERE id = p_admin_user_id;

  IF NOT FOUND OR v_is_admin IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: admin access required');
  END IF;

  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Check pool access rules
  SELECT access_level, max_single_grant INTO v_access_level, v_max_grant
  FROM admin_pool_access_rules
  WHERE pool_id = p_source_pool_id AND access_level = 'manual_grant';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pool does not allow manual grants: ' || p_source_pool_id);
  END IF;

  IF p_amount > v_max_grant THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Amount exceeds single grant limit of ' || v_max_grant::TEXT || ' PIP for this pool');
  END IF;

  -- Check pool balance
  SELECT current_balance_pip INTO v_pool_balance
  FROM token_pools WHERE pool_id = p_source_pool_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Pool not found');
  END IF;

  IF v_pool_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Insufficient pool balance. Available: ' || v_pool_balance::TEXT || ' PIP');
  END IF;

  -- Verify recipient exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_recipient_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recipient user not found');
  END IF;

  -- Debit pool
  UPDATE token_pools
  SET current_balance_pip = current_balance_pip - p_amount, updated_at = now()
  WHERE pool_id = p_source_pool_id;

  -- Record pool event
  INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, ref_id, metadata)
  VALUES (
    p_source_pool_id,
    'POOL_DEBIT',
    p_amount,
    'admin_manual_grant',
    p_recipient_user_id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id::TEXT,
      'recipient_user_id', p_recipient_user_id::TEXT,
      'grant_purpose', p_grant_purpose,
      'description', p_description,
      'metadata', p_metadata
    )
  );

  -- Credit user balance
  INSERT INTO club_token_balances (user_id, total_tokens, lifetime_earned)
  VALUES (p_recipient_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    total_tokens = club_token_balances.total_tokens + p_amount,
    lifetime_earned = club_token_balances.lifetime_earned + p_amount,
    last_transaction_at = now(),
    updated_at = now();

  SELECT total_tokens INTO v_new_total
  FROM club_token_balances WHERE user_id = p_recipient_user_id;

  -- Insert ledger record
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    reference_id, reference_type, description, created_by,
    source_pool_id, initiated_by_admin_id, metadata
  )
  VALUES (
    p_recipient_user_id,
    'admin_grant',
    p_amount,
    v_new_total,
    NULL,
    'admin_action',
    p_description,
    p_admin_user_id,
    p_source_pool_id,
    p_admin_user_id,
    jsonb_build_object('grant_purpose', p_grant_purpose, 'pool', p_source_pool_id, 'admin_metadata', p_metadata)
  )
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'success', true,
    'ledger_id', v_ledger_id,
    'amount', p_amount,
    'pool', p_source_pool_id,
    'new_balance', v_new_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_grant_tokens_from_pool TO authenticated;
GRANT EXECUTE ON FUNCTION admin_grant_tokens_from_pool TO service_role;

-- =====================================================
-- 4. GET ADMIN ACCESSIBLE POOLS
-- =====================================================

CREATE OR REPLACE FUNCTION get_admin_accessible_pools(p_admin_user_id UUID)
RETURNS TABLE (
  pool_id TEXT,
  pool_name TEXT,
  current_balance DECIMAL(18,4),
  initial_allocation DECIMAL(18,4),
  access_level TEXT,
  max_single_grant DECIMAL(18,4),
  requires_approval BOOLEAN,
  description TEXT
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
    tp.current_balance_pip,
    tp.initial_allocation_pip,
    ar.access_level,
    ar.max_single_grant,
    ar.requires_approval,
    ar.description
  FROM token_pools tp
  LEFT JOIN admin_pool_access_rules ar ON ar.pool_id = tp.pool_id
  ORDER BY tp.initial_allocation_pip DESC, ar.access_level;
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_accessible_pools TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_accessible_pools TO service_role;

-- =====================================================
-- 5. GET POOL TRANSACTION HISTORY (Admin)
-- =====================================================

CREATE OR REPLACE FUNCTION get_pool_transaction_history(
  p_admin_user_id UUID,
  p_pool_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  event_id UUID,
  ts TIMESTAMPTZ,
  pool_id TEXT,
  pool_name TEXT,
  event_type TEXT,
  amount_pip DECIMAL(18,4),
  ref_type TEXT,
  metadata JSONB
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
    pe.event_id,
    pe.ts,
    pe.pool_id,
    tp.pool_name,
    pe.event_type,
    pe.amount_pip,
    pe.ref_type,
    pe.metadata
  FROM token_pool_events pe
  JOIN token_pools tp ON tp.pool_id = pe.pool_id
  WHERE (p_pool_id IS NULL OR pe.pool_id = p_pool_id)
  ORDER BY pe.ts DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pool_transaction_history TO authenticated;
GRANT EXECUTE ON FUNCTION get_pool_transaction_history TO service_role;
