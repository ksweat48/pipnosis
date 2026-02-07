/*
  # Admin Unlimited Credits - SSOT Enforcement

  1. Problem
    - Admin users see "50 credits" instead of unlimited
    - The get_user_token_balance RPC does not return admin status
    - The deduct_tokens RPC deducts credits from admins, which should be bypassed

  2. Changes
    - Updates get_user_token_balance to include is_admin flag in response
    - Updates deduct_tokens to skip deduction for admin users (returns success without modifying balance)
    - Both functions check user_profiles.is_admin as the SSOT for admin status

  3. Security
    - Admin status is determined server-side from user_profiles table (not client-controlled)
    - No RLS changes needed - existing policies remain intact
*/

CREATE OR REPLACE FUNCTION get_user_token_balance(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance numeric;
  v_is_admin boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User ID is required'
    );
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = p_user_id;

  v_is_admin := COALESCE(v_is_admin, false);

  SELECT balance INTO v_balance
  FROM user_token_balance
  WHERE user_id = p_user_id;

  IF v_balance IS NULL THEN
    INSERT INTO user_token_balance (user_id, balance, created_at, updated_at)
    VALUES (p_user_id, 50.0, NOW(), NOW())
    RETURNING balance INTO v_balance;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'balance', v_balance,
    'user_id', p_user_id,
    'is_admin', v_is_admin
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;


CREATE OR REPLACE FUNCTION deduct_tokens(
  p_user_id uuid,
  p_amount numeric,
  p_transaction_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric;
  v_new_balance numeric;
  v_is_admin boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User ID is required'
    );
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be positive'
    );
  END IF;

  IF p_transaction_type IS NULL OR p_transaction_type = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Transaction type is required'
    );
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = p_user_id;

  IF COALESCE(v_is_admin, false) = true THEN
    SELECT balance INTO v_current_balance
    FROM user_token_balance
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'new_balance', COALESCE(v_current_balance, 999999),
      'amount_deducted', 0,
      'transaction_type', p_transaction_type,
      'admin_bypass', true
    );
  END IF;

  SELECT balance INTO v_current_balance
  FROM user_token_balance
  WHERE user_id = p_user_id;

  IF v_current_balance IS NULL THEN
    INSERT INTO user_token_balance (user_id, balance, created_at, updated_at)
    VALUES (p_user_id, 50.0, NOW(), NOW())
    RETURNING balance INTO v_current_balance;
  END IF;

  IF v_current_balance < p_amount THEN
    BEGIN
      INSERT INTO credit_transaction_audit (
        user_id, amount, transaction_type, balance_before, balance_after, metadata, created_at
      )
      VALUES (
        p_user_id, -p_amount, p_transaction_type || '_FAILED',
        v_current_balance, v_current_balance,
        jsonb_build_object('reason', 'Insufficient balance', 'metadata', p_metadata),
        NOW()
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient balance',
      'required', p_amount,
      'available', v_current_balance
    );
  END IF;

  UPDATE user_token_balance
  SET balance = balance - p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_new_balance;

  BEGIN
    INSERT INTO credit_transaction_audit (
      user_id, amount, transaction_type, balance_before, balance_after, metadata, created_at
    )
    VALUES (
      p_user_id, -p_amount, p_transaction_type,
      v_current_balance, v_new_balance,
      p_metadata, NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'amount_deducted', p_amount,
    'transaction_type', p_transaction_type
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;
