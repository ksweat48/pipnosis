/*
  # Token Pool RPC Functions

  ## Overview
  Creates RPC functions for atomic token pool operations:
  - debit_token_pool - Reduce pool balance
  - credit_token_pool - Increase pool balance
  - transfer_between_token_pools - Atomic transfer
  - get_circulating_supply - Get user token totals

  ## Security
  - All functions are SECURITY DEFINER (service role permissions)
  - Enforce constraints (no negative balances, valid amounts)
  - Create event records for all mutations
  
  ## SSOT Compliance
  - Single atomic operation per pool mutation
  - Event-sourced audit trail
  - Integrity checks built-in
*/

-- =====================================================
-- 1. DEBIT TOKEN POOL (Reduce balance)
-- =====================================================

CREATE OR REPLACE FUNCTION debit_token_pool(
  p_pool_id TEXT,
  p_amount DECIMAL(18,4),
  p_ref_type TEXT,
  p_ref_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_balance DECIMAL(18,4);
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive';
  END IF;

  -- Validate pool exists and get current balance
  SELECT current_balance_pip INTO v_current_balance
  FROM token_pools
  WHERE pool_id = p_pool_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pool not found: %', p_pool_id;
  END IF;

  -- Check sufficient balance
  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient pool balance. Pool: %, Current: %, Requested: %',
      p_pool_id, v_current_balance, p_amount;
  END IF;

  -- Update pool balance
  UPDATE token_pools
  SET
    current_balance_pip = current_balance_pip - p_amount,
    updated_at = now()
  WHERE pool_id = p_pool_id;

  -- Create event record
  INSERT INTO token_pool_events (
    pool_id,
    event_type,
    amount_pip,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_pool_id,
    'POOL_DEBIT',
    p_amount,
    p_ref_type,
    p_ref_id,
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION debit_token_pool TO service_role;
GRANT EXECUTE ON FUNCTION debit_token_pool TO authenticated;

-- =====================================================
-- 2. CREDIT TOKEN POOL (Increase balance)
-- =====================================================

CREATE OR REPLACE FUNCTION credit_token_pool(
  p_pool_id TEXT,
  p_amount DECIMAL(18,4),
  p_ref_type TEXT,
  p_ref_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  -- Validate pool exists
  IF NOT EXISTS (SELECT 1 FROM token_pools WHERE pool_id = p_pool_id) THEN
    RAISE EXCEPTION 'Pool not found: %', p_pool_id;
  END IF;

  -- Update pool balance
  UPDATE token_pools
  SET
    current_balance_pip = current_balance_pip + p_amount,
    updated_at = now()
  WHERE pool_id = p_pool_id;

  -- Create event record
  INSERT INTO token_pool_events (
    pool_id,
    event_type,
    amount_pip,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_pool_id,
    'POOL_CREDIT',
    p_amount,
    p_ref_type,
    p_ref_id,
    p_metadata
  );
END;
$$;

GRANT EXECUTE ON FUNCTION credit_token_pool TO service_role;
GRANT EXECUTE ON FUNCTION credit_token_pool TO authenticated;

-- =====================================================
-- 3. TRANSFER BETWEEN TOKEN POOLS (Atomic)
-- =====================================================

CREATE OR REPLACE FUNCTION transfer_between_token_pools(
  p_from_pool_id TEXT,
  p_to_pool_id TEXT,
  p_amount DECIMAL(18,4),
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_from_balance DECIMAL(18,4);
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;

  -- Validate pools are different
  IF p_from_pool_id = p_to_pool_id THEN
    RAISE EXCEPTION 'Cannot transfer to the same pool';
  END IF;

  -- Validate source pool and get balance
  SELECT current_balance_pip INTO v_from_balance
  FROM token_pools
  WHERE pool_id = p_from_pool_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source pool not found: %', p_from_pool_id;
  END IF;

  -- Check sufficient balance
  IF v_from_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance in source pool. Pool: %, Current: %, Requested: %',
      p_from_pool_id, v_from_balance, p_amount;
  END IF;

  -- Validate destination pool exists
  IF NOT EXISTS (SELECT 1 FROM token_pools WHERE pool_id = p_to_pool_id) THEN
    RAISE EXCEPTION 'Destination pool not found: %', p_to_pool_id;
  END IF;

  -- Debit source pool
  UPDATE token_pools
  SET
    current_balance_pip = current_balance_pip - p_amount,
    updated_at = now()
  WHERE pool_id = p_from_pool_id;

  -- Credit destination pool
  UPDATE token_pools
  SET
    current_balance_pip = current_balance_pip + p_amount,
    updated_at = now()
  WHERE pool_id = p_to_pool_id;

  -- Create transfer event for source pool
  INSERT INTO token_pool_events (
    pool_id,
    event_type,
    amount_pip,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_from_pool_id,
    'POOL_TRANSFER',
    p_amount,
    'transfer_out',
    NULL,
    jsonb_build_object(
      'to_pool', p_to_pool_id,
      'reason', p_reason,
      'metadata', p_metadata
    )
  );

  -- Create transfer event for destination pool
  INSERT INTO token_pool_events (
    pool_id,
    event_type,
    amount_pip,
    ref_type,
    ref_id,
    metadata
  ) VALUES (
    p_to_pool_id,
    'POOL_TRANSFER',
    p_amount,
    'transfer_in',
    NULL,
    jsonb_build_object(
      'from_pool', p_from_pool_id,
      'reason', p_reason,
      'metadata', p_metadata
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_between_token_pools TO service_role;
GRANT EXECUTE ON FUNCTION transfer_between_token_pools TO authenticated;

-- =====================================================
-- 4. GET CIRCULATING SUPPLY
-- =====================================================

CREATE OR REPLACE FUNCTION get_circulating_supply()
RETURNS TABLE (
  total_liquid DECIMAL(18,4),
  total_staked DECIMAL(18,4),
  total_rewards_pending DECIMAL(18,4),
  total_vested DECIMAL(18,4),
  total_circulating DECIMAL(18,4)
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(pip_liquid), 0)::DECIMAL(18,4) AS total_liquid,
    COALESCE(SUM(pip_staked), 0)::DECIMAL(18,4) AS total_staked,
    COALESCE(SUM(pip_rewards_pending), 0)::DECIMAL(18,4) AS total_rewards_pending,
    COALESCE(SUM(pip_vested), 0)::DECIMAL(18,4) AS total_vested,
    COALESCE(
      SUM(pip_liquid + pip_staked + pip_rewards_pending + pip_vested),
      0
    )::DECIMAL(18,4) AS total_circulating
  FROM token_balances;
END;
$$;

GRANT EXECUTE ON FUNCTION get_circulating_supply TO authenticated;
GRANT EXECUTE ON FUNCTION get_circulating_supply TO service_role;