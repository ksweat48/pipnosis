/*
  # Create Stripe Credit Transaction Function

  1. Purpose
    - Create RPC function to safely add credits from Stripe payments
    - Handles both one-time purchases and subscription renewals
    - Records transaction history for audit

  2. Function: add_credits_transaction
    - Parameters:
      - p_user_id (uuid): User receiving credits
      - p_amount (numeric): Credit amount to add
      - p_transaction_type (text): Type of transaction
      - p_description (text): Transaction description
    - Returns: void
    - Security: Uses service role from webhook handler

  3. Features
    - Atomic credit addition with transaction logging
    - Updates token_balance table
    - Records in token_transactions table for history
*/

-- Create function to add credits from Stripe payments
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
  v_current_balance numeric;
  v_new_balance numeric;
BEGIN
  -- Get current balance (or 0 if no record exists)
  SELECT credit_balance INTO v_current_balance
  FROM token_balance
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    v_current_balance := 0;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + p_amount;

  -- Upsert token_balance
  INSERT INTO token_balance (user_id, credit_balance, lifetime_credits_earned)
  VALUES (p_user_id, v_new_balance, p_amount)
  ON CONFLICT (user_id)
  DO UPDATE SET
    credit_balance = v_new_balance,
    lifetime_credits_earned = token_balance.lifetime_credits_earned + p_amount,
    updated_at = now();

  -- Record transaction
  INSERT INTO token_transactions (
    user_id,
    transaction_type,
    amount,
    balance_after,
    description
  ) VALUES (
    p_user_id,
    p_transaction_type,
    p_amount,
    v_new_balance,
    p_description
  );

  RAISE NOTICE 'Added % credits to user %. New balance: %', p_amount, p_user_id, v_new_balance;
END;
$$;

-- Grant execute permission to service role (used by webhook)
GRANT EXECUTE ON FUNCTION add_credits_transaction TO service_role;

COMMENT ON FUNCTION add_credits_transaction IS 'Safely adds credits from Stripe payments with transaction logging';
