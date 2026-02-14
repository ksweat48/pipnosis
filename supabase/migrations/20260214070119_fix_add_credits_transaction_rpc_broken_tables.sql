/*
  # Fix Broken add_credits_transaction RPC

  ## Problem
  The `add_credits_transaction` function references two tables that DO NOT EXIST:
  - `token_balance` (should be `user_token_balance`)
  - `token_transactions` (should be `token_transaction_history`)

  This caused ALL Stripe credit purchases to silently fail — payment succeeds
  on Stripe but credits never arrive in the user's account.

  ## Fix
  Rewrite `add_credits_transaction` to use the correct SSOT tables:
  - `user_token_balance` for balance storage (columns: user_id, balance, lifetime_earned, lifetime_spent)
  - `token_transaction_history` for audit trail (columns: user_id, transaction_type, amount, balance_before, balance_after, metadata)

  ## SSOT Authority
  - Balance: `user_token_balance` (single source of truth for credit balances)
  - Transactions: `token_transaction_history` (single source of truth for credit audit trail)
  - Aligned with existing working RPCs: `add_tokens`, `deduct_tokens`, `get_user_token_balance`

  ## Security
  - Function runs as SECURITY DEFINER to bypass RLS for webhook calls
  - Only callable via service_role from the Stripe webhook (Netlify function)
*/

CREATE OR REPLACE FUNCTION add_credits_transaction(
  p_user_id uuid,
  p_amount numeric,
  p_transaction_type text,
  p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_balance numeric;
  v_new_balance numeric;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_old_balance
  FROM user_token_balance
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    v_old_balance := 0;
  END IF;

  v_new_balance := v_old_balance + p_amount;

  INSERT INTO user_token_balance (user_id, balance, lifetime_earned, lifetime_spent, created_at, updated_at)
  VALUES (p_user_id, v_new_balance, p_amount, 0, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET
    balance = v_new_balance,
    lifetime_earned = user_token_balance.lifetime_earned + p_amount,
    updated_at = NOW();

  INSERT INTO token_transaction_history (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    metadata,
    created_at
  ) VALUES (
    p_user_id,
    p_transaction_type,
    p_amount,
    v_old_balance,
    v_new_balance,
    jsonb_build_object('description', p_description, 'source', 'stripe_webhook'),
    NOW()
  );
END;
$$;
