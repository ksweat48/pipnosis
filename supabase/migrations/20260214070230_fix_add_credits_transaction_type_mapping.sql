/*
  # Fix add_credits_transaction Transaction Type Mapping

  ## Problem
  The Stripe webhook sends transaction types that don't match the
  `token_transaction_history_transaction_type_check` constraint:
  - Webhook sends `package_purchase` -> constraint expects `purchase_onetime`
  - Webhook sends `subscription_purchase` -> constraint expects `purchase_subscription`
  - Webhook sends `subscription_renewal` -> this one is correct

  ## Fix
  Update `add_credits_transaction` to map incoming types to the correct constrained values.
  This prevents webhook failures without requiring changes to the Netlify function.

  ## SSOT
  - Type constraint authority: `token_transaction_history_transaction_type_check`
  - RPC maps incoming types to the canonical constrained values
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
  v_mapped_type text;
BEGIN
  v_mapped_type := CASE p_transaction_type
    WHEN 'package_purchase' THEN 'purchase_onetime'
    WHEN 'subscription_purchase' THEN 'purchase_subscription'
    ELSE p_transaction_type
  END;

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
    user_id, transaction_type, amount, balance_before, balance_after, metadata, created_at
  ) VALUES (
    p_user_id,
    v_mapped_type,
    p_amount,
    v_old_balance,
    v_new_balance,
    jsonb_build_object('description', p_description, 'source', 'stripe_webhook'),
    NOW()
  );
END;
$$;
