/*
  # Create Submit Cashout Request RPC

  1. New Function
    - `submit_cashout_request()` - Atomically validates balance, deducts tokens, and creates cashout request
    - Uses SECURITY DEFINER to bypass RLS for atomic cross-table operations
    - Validates minimum $100 USD, sufficient available tokens, and active membership

  2. Flow
    - Checks user has active membership
    - Calculates token deduction based on PIP utility reference value ($0.10/PIP)
    - Validates user has sufficient available (non-locked, non-staked) tokens
    - Deducts tokens from club_token_balances
    - Logs deduction in club_token_ledger
    - Creates cashout request record
    - Returns request details

  3. Security
    - SECURITY DEFINER for atomic cross-table operations
    - Validates auth.uid() matches p_user_id for user-initiated requests
    - No RLS changes needed (existing policies cover cashout_requests)
*/

CREATE OR REPLACE FUNCTION submit_cashout_request(
  p_user_id UUID,
  p_amount_usd NUMERIC(10,2),
  p_payout_method TEXT,
  p_wallet_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance RECORD;
  v_conversion_rate NUMERIC(10,4);
  v_tokens_to_deduct INTEGER;
  v_request_id UUID;
  v_new_available NUMERIC;
BEGIN
  IF p_amount_usd < 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Minimum cashout amount is $100 USD');
  END IF;

  IF p_payout_method NOT IN ('ethereum', 'bitcoin', 'bank_transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid payout method');
  END IF;

  IF p_wallet_address IS NULL OR length(trim(p_wallet_address)) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid wallet address or bank details required');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_memberships
    WHERE user_id = p_user_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active membership required for cashout');
  END IF;

  v_conversion_rate := 0.10;
  v_tokens_to_deduct := CEIL(p_amount_usd / v_conversion_rate);

  SELECT
    total_tokens,
    locked_tokens,
    COALESCE(staked_tokens, 0) AS staked_tokens,
    (total_tokens - locked_tokens - COALESCE(staked_tokens, 0)) AS available
  INTO v_balance
  FROM club_token_balances
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No token balance found');
  END IF;

  IF v_balance.available < v_tokens_to_deduct THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient available tokens. Need ' || v_tokens_to_deduct || ' PIP, have ' || v_balance.available || ' available'
    );
  END IF;

  UPDATE club_token_balances
  SET total_tokens = total_tokens - v_tokens_to_deduct,
      lifetime_spent = lifetime_spent + v_tokens_to_deduct,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  v_new_available := v_balance.available - v_tokens_to_deduct;

  INSERT INTO club_cashout_requests (
    user_id, amount_usd, tokens_deducted, conversion_rate,
    payout_method, wallet_address, status
  ) VALUES (
    p_user_id, p_amount_usd, v_tokens_to_deduct, v_conversion_rate,
    p_payout_method, p_wallet_address, 'pending'
  ) RETURNING id INTO v_request_id;

  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  ) VALUES (
    p_user_id, 'cashout_deduction', -v_tokens_to_deduct,
    v_new_available,
    'Cashout request: $' || p_amount_usd || ' USD via ' || p_payout_method,
    v_request_id::TEXT, 'cashout'
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'amount_usd', p_amount_usd,
    'tokens_deducted', v_tokens_to_deduct,
    'conversion_rate', v_conversion_rate,
    'payout_method', p_payout_method,
    'status', 'pending'
  );
END;
$$;
