/*
  # Credit greenhaggai@gmail.com 1000 Credits from Stripe Purchase

  ## Context
  User greenhaggai@gmail.com (e49c244a-a0f7-4a54-8aae-762718d6a5ea) completed a
  successful Stripe payment for 1000 credits, but the credits were never applied
  because the `add_credits_transaction` RPC was broken.

  ## Action
  - Add 1000 credits to user's balance
  - Record transaction with correct constrained type `purchase_onetime`
  - Expected final balance: 40 + 1000 = 1040

  ## SSOT
  - Balance: `user_token_balance`
  - Audit: `token_transaction_history`
*/

DO $$
DECLARE
  v_user_id uuid := 'e49c244a-a0f7-4a54-8aae-762718d6a5ea';
  v_old_balance numeric;
  v_new_balance numeric;
  v_credit_amount numeric := 1000;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_old_balance
  FROM user_token_balance
  WHERE user_id = v_user_id;

  v_new_balance := v_old_balance + v_credit_amount;

  UPDATE user_token_balance
  SET
    balance = v_new_balance,
    lifetime_earned = lifetime_earned + v_credit_amount,
    updated_at = NOW()
  WHERE user_id = v_user_id;

  INSERT INTO token_transaction_history (
    user_id, transaction_type, amount, balance_before, balance_after, metadata, created_at
  ) VALUES (
    v_user_id,
    'purchase_onetime',
    v_credit_amount,
    v_old_balance,
    v_new_balance,
    jsonb_build_object(
      'description', 'Purchased 1000 Credits - $25.00',
      'source', 'manual_correction_stripe_webhook_failure',
      'correction_date', NOW()::text
    ),
    NOW()
  );
END;
$$;
