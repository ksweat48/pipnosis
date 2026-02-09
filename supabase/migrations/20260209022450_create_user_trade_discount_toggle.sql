/*
  # Create User Trade Discount Toggle System

  1. New Tables
    - `user_trade_discount_settings`
      - `user_id` (uuid, primary key, references auth.users)
      - `use_trade_discounts` (boolean, default false)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Purpose
    - Users must explicitly opt in to spend PIP tokens for trade credit discounts
    - Default OFF for all users — no PIP is burned unless user enables this
    - Toggle persists across sessions (server-side)

  3. Security
    - RLS enabled with per-user ownership policies
    - Users can only read/update their own settings

  4. RPCs
    - `get_user_trade_discount_enabled(p_user_id)` — returns boolean
    - `set_user_trade_discount_enabled(p_user_id, p_enabled)` — upserts setting

  5. Integration
    - `quote_trade_cost` RPC patched to check this setting before applying discounts
    - If setting is OFF, discount_pct forced to 0 and no PIP burn occurs
*/

-- 1. Create the settings table
CREATE TABLE IF NOT EXISTS user_trade_discount_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  use_trade_discounts BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_trade_discount_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own discount settings"
  ON user_trade_discount_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own discount settings"
  ON user_trade_discount_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own discount settings"
  ON user_trade_discount_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to discount settings"
  ON user_trade_discount_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. RPC: Get user trade discount toggle state
CREATE OR REPLACE FUNCTION get_user_trade_discount_enabled(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT use_trade_discounts INTO v_enabled
  FROM user_trade_discount_settings
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN COALESCE(v_enabled, false);
END;
$$;

-- 3. RPC: Set user trade discount toggle state
CREATE OR REPLACE FUNCTION set_user_trade_discount_enabled(p_user_id UUID, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value BOOLEAN;
BEGIN
  SELECT use_trade_discounts INTO v_old_value
  FROM user_trade_discount_settings
  WHERE user_id = p_user_id;

  INSERT INTO user_trade_discount_settings (user_id, use_trade_discounts, updated_at)
  VALUES (p_user_id, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE
  SET use_trade_discounts = p_enabled,
      updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_value', COALESCE(v_old_value, false),
    'new_value', p_enabled,
    'updated_at', now()
  );
END;
$$;

-- 4. Patch quote_trade_cost to respect toggle
-- Drop and recreate with the toggle check embedded
DROP FUNCTION IF EXISTS quote_trade_cost(UUID, TEXT);

CREATE OR REPLACE FUNCTION quote_trade_cost(p_user_id UUID, p_trade_intent_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_quote RECORD;
  v_is_admin BOOLEAN := false;
  v_tier_level INT := 0;
  v_tier_name TEXT := 'None';
  v_discount_pct NUMERIC(5,4) := 0;
  v_base_cost NUMERIC(10,2) := 10.00;
  v_final_cost NUMERIC(10,2);
  v_credit_savings NUMERIC(10,2);
  v_pip_to_burn NUMERIC(10,2) := 0;
  v_user_pip NUMERIC(20,2) := 0;
  v_user_credits NUMERIC(20,2) := 0;
  v_degraded BOOLEAN := false;
  v_quote_id UUID;
  v_discount_enabled BOOLEAN := false;
BEGIN
  -- Idempotency: check for existing unexpired quote
  SELECT * INTO v_existing_quote
  FROM trade_cost_quotes
  WHERE trade_intent_id = p_trade_intent_id
    AND user_id = p_user_id
    AND status IN ('approved', 'executed')
    AND expires_at > now();

  IF FOUND THEN
    RETURN jsonb_build_object(
      'quote_id', v_existing_quote.id,
      'status', v_existing_quote.status,
      'base_credit_cost', v_existing_quote.base_credit_cost,
      'discount_pct', v_existing_quote.discount_pct,
      'credit_discount_amount', v_existing_quote.base_credit_cost - v_existing_quote.final_credit_cost,
      'final_credit_cost', v_existing_quote.final_credit_cost,
      'pip_to_burn', v_existing_quote.pip_to_burn,
      'membership_tier', v_existing_quote.tier_level,
      'tier_name', v_existing_quote.tier_name,
      'degraded', v_existing_quote.degraded,
      'admin_bypass', (v_existing_quote.tier_level = 99),
      'idempotent_hit', true
    );
  END IF;

  -- Check admin status
  SELECT is_admin INTO v_is_admin
  FROM user_profiles
  WHERE id = p_user_id;

  IF v_is_admin = true THEN
    v_quote_id := gen_random_uuid();
    INSERT INTO trade_cost_quotes (
      id, user_id, trade_intent_id, tier_level, tier_name,
      discount_pct, base_credit_cost, final_credit_cost,
      pip_to_burn, degraded, status, expires_at
    ) VALUES (
      v_quote_id, p_user_id, p_trade_intent_id, 99, 'Admin',
      0, 0, 0, 0, false, 'approved', now() + interval '5 minutes'
    );

    RETURN jsonb_build_object(
      'quote_id', v_quote_id,
      'status', 'approved',
      'base_credit_cost', 0,
      'discount_pct', 0,
      'credit_discount_amount', 0,
      'final_credit_cost', 0,
      'pip_to_burn', 0,
      'membership_tier', 99,
      'tier_name', 'Admin',
      'degraded', false,
      'admin_bypass', true
    );
  END IF;

  -- Check user discount toggle setting
  SELECT COALESCE(use_trade_discounts, false) INTO v_discount_enabled
  FROM user_trade_discount_settings
  WHERE user_id = p_user_id;

  -- Get membership tier
  SELECT
    COALESCE(cmp.tier_level, 0),
    COALESCE(cmp.name, 'None'),
    CASE
      WHEN v_discount_enabled = true THEN COALESCE(cmp.discount_pct, 0)
      ELSE 0
    END
  INTO v_tier_level, v_tier_name, v_discount_pct
  FROM club_memberships cm
  JOIN club_membership_packages cmp ON cm.tier_level = cmp.tier_level
  WHERE cm.user_id = p_user_id
    AND cm.status = 'active'
  ORDER BY cmp.tier_level DESC
  LIMIT 1;

  -- Cap discount
  IF v_discount_pct > 0.2000 THEN
    v_discount_pct := 0.2000;
  END IF;

  -- Calculate costs
  v_credit_savings := ROUND(v_base_cost * v_discount_pct, 2);
  v_final_cost := GREATEST(v_base_cost - v_credit_savings, 8.00);
  v_credit_savings := v_base_cost - v_final_cost;

  -- Calculate PIP burn (only if discount is applied)
  IF v_credit_savings > 0 THEN
    v_pip_to_burn := CEIL(v_credit_savings * 10.0 * 100) / 100.0;

    -- Check PIP balance for graceful degradation
    SELECT COALESCE(available_tokens, 0) INTO v_user_pip
    FROM club_token_balances
    WHERE user_id = p_user_id;

    IF v_user_pip < v_pip_to_burn THEN
      -- Graceful degradation: no discount, no burn
      v_discount_pct := 0;
      v_credit_savings := 0;
      v_final_cost := v_base_cost;
      v_pip_to_burn := 0;
      v_degraded := true;
    END IF;
  END IF;

  -- Check credit balance
  SELECT COALESCE(credit_balance, 0) INTO v_user_credits
  FROM user_token_balance
  WHERE user_id = p_user_id;

  IF v_user_credits < v_final_cost THEN
    RETURN jsonb_build_object(
      'quote_id', null,
      'status', 'rejected',
      'reason', 'INSUFFICIENT_CREDITS',
      'base_credit_cost', v_base_cost,
      'discount_pct', v_discount_pct,
      'final_credit_cost', v_final_cost,
      'pip_to_burn', v_pip_to_burn,
      'membership_tier', v_tier_level,
      'tier_name', v_tier_name,
      'degraded', v_degraded
    );
  END IF;

  -- Create the quote
  v_quote_id := gen_random_uuid();
  INSERT INTO trade_cost_quotes (
    id, user_id, trade_intent_id, tier_level, tier_name,
    discount_pct, base_credit_cost, final_credit_cost,
    pip_to_burn, degraded, status, expires_at
  ) VALUES (
    v_quote_id, p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
    v_discount_pct, v_base_cost, v_final_cost,
    v_pip_to_burn, v_degraded, 'approved', now() + interval '5 minutes'
  );

  RETURN jsonb_build_object(
    'quote_id', v_quote_id,
    'status', 'approved',
    'base_credit_cost', v_base_cost,
    'discount_pct', v_discount_pct,
    'credit_discount_amount', v_credit_savings,
    'final_credit_cost', v_final_cost,
    'pip_to_burn', v_pip_to_burn,
    'membership_tier', v_tier_level,
    'tier_name', v_tier_name,
    'degraded', v_degraded,
    'admin_bypass', false
  );
END;
$$;
