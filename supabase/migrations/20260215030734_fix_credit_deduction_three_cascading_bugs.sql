/*
  # Fix Credit Deduction - Three Cascading Bugs

  ## Root Cause Analysis
  Credit deduction has NEVER worked since the quote system was introduced.
  Zero rows exist in trade_cost_quotes and credit_deduction_history.
  Three bugs chain together to prevent any credit deduction:

  1. **PostgREST Overload Ambiguity**
     - Two `quote_trade_cost` functions exist: one with TEXT param, one with UUID
     - PostgREST cannot disambiguate when Supabase JS client sends a string UUID
     - The TEXT version also references non-existent column `credit_balance` (should be `balance`)
     - FIX: Drop the TEXT overload. UUID version matches `trade_cost_quotes.trade_intent_id` type.

  2. **Admin Zero-Cost Constraint Violation**
     - `trade_cost_quotes_final_cost_floor` CHECK requires `final_credit_cost >= 8.00`
     - Admin bypass inserts `final_credit_cost = 0.0` which violates this constraint
     - FIX: Allow zero cost when membership_tier = 99 (admin)

  3. **NULL Membership Tier for Non-Members**
     - When a user has no active club membership, `SELECT INTO` returns no rows
     - This sets `v_tier_level` and `v_tier_name` to NULL (overriding DECLARE defaults)
     - `membership_tier` NOT NULL column then rejects the insert
     - FIX: Add `IF NOT FOUND` guard to restore defaults after SELECT INTO

  ## Additional Fix
  - Unblock all sessions that were incorrectly credit-blocked
  - These sessions were blocked because the quote RPC kept failing

  ## Security
  - No RLS changes
  - SECURITY DEFINER maintained on quote_trade_cost
  - All existing policies preserved

  ## CCIP Compliance
  - Single authoritative `quote_trade_cost(uuid, uuid)` function
  - TEXT overload removed to eliminate ambiguity
  - Constraint corrected to allow admin zero-cost operations
*/

-- STEP 1: Drop the ambiguous TEXT overload
-- This is the root cause of PostgREST 300 errors
DROP FUNCTION IF EXISTS public.quote_trade_cost(uuid, text);

-- STEP 2: Fix the final_cost_floor constraint to allow admin zero-cost quotes
ALTER TABLE trade_cost_quotes DROP CONSTRAINT IF EXISTS trade_cost_quotes_final_cost_floor;
ALTER TABLE trade_cost_quotes ADD CONSTRAINT trade_cost_quotes_final_cost_floor
  CHECK (final_credit_cost >= 8.00 OR membership_tier = 99);

-- STEP 3: Recreate quote_trade_cost(uuid, uuid) with NULL-safe membership handling
CREATE OR REPLACE FUNCTION public.quote_trade_cost(p_user_id uuid, p_trade_intent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_quote RECORD;
  v_discount_pct NUMERIC := 0.0;
  v_tier_level INTEGER := 0;
  v_tier_name TEXT := 'None';
  v_base_cost NUMERIC := 10.00;
  v_credit_savings NUMERIC := 0.00;
  v_final_cost NUMERIC := 10.00;
  v_pip_to_burn NUMERIC := 0.00;
  v_credit_balance NUMERIC;
  v_pip_available NUMERIC;
  v_degraded BOOLEAN := false;
  v_quote_id UUID;
  v_is_admin BOOLEAN := false;
  v_discount_enabled BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL OR p_trade_intent_id IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'MISSING_PARAMETERS');
  END IF;

  -- Idempotency: check for existing unexpired quote
  SELECT id, status, final_credit_cost, pip_to_burn, discount_pct, tier_name, membership_tier, degraded
  INTO v_existing_quote
  FROM trade_cost_quotes
  WHERE trade_intent_id = p_trade_intent_id
    AND user_id = p_user_id
    AND status IN ('approved', 'executed')
    AND expires_at > now();

  IF FOUND THEN
    RETURN jsonb_build_object(
      'quote_id', v_existing_quote.id,
      'status', v_existing_quote.status,
      'base_credit_cost', v_base_cost,
      'discount_pct', v_existing_quote.discount_pct,
      'credit_discount_amount', v_base_cost - v_existing_quote.final_credit_cost,
      'final_credit_cost', v_existing_quote.final_credit_cost,
      'pip_to_burn', v_existing_quote.pip_to_burn,
      'membership_tier', v_existing_quote.membership_tier,
      'tier_name', v_existing_quote.tier_name,
      'degraded', v_existing_quote.degraded,
      'admin_bypass', (v_existing_quote.membership_tier = 99),
      'idempotent_hit', true
    );
  END IF;

  -- Check admin status
  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM user_profiles WHERE id = p_user_id;

  IF v_is_admin = true THEN
    v_quote_id := gen_random_uuid();
    INSERT INTO trade_cost_quotes (
      id, user_id, trade_intent_id, membership_tier, tier_name,
      discount_pct, base_credit_cost, credit_discount_amount,
      final_credit_cost, pip_to_burn, status, degraded, expires_at
    ) VALUES (
      v_quote_id, p_user_id, p_trade_intent_id, 99, 'Admin',
      0.0, 0.0, 0.0, 0.0, 0.0, 'approved', false,
      now() + interval '5 minutes'
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

  -- Check user discount toggle
  SELECT COALESCE(use_trade_discounts, false) INTO v_discount_enabled
  FROM user_trade_discount_settings
  WHERE user_id = p_user_id;

  -- Get membership tier (NULL-safe: IF NOT FOUND keeps defaults)
  SELECT
    COALESCE(pkg.discount_pct, 0.0),
    COALESCE(m.tier_level, 0),
    COALESCE(pkg.name, 'None')
  INTO v_discount_pct, v_tier_level, v_tier_name
  FROM club_memberships m
  JOIN club_membership_packages pkg ON pkg.id = m.package_id
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND pkg.is_active = true
  LIMIT 1;

  -- FIX: If no membership found, SELECT INTO sets vars to NULL. Restore defaults.
  IF NOT FOUND THEN
    v_discount_pct := 0.0;
    v_tier_level := 0;
    v_tier_name := 'None';
  END IF;

  -- Disable discount if user toggle is off
  IF v_discount_enabled = false THEN
    v_discount_pct := 0.0;
  END IF;

  -- Cap discount at 20%
  v_discount_pct := LEAST(COALESCE(v_discount_pct, 0.0), 0.2000);

  -- Calculate costs
  v_credit_savings := ROUND(v_base_cost * v_discount_pct, 2);
  v_final_cost := GREATEST(v_base_cost - v_credit_savings, 8.00);
  v_credit_savings := v_base_cost - v_final_cost;

  -- Calculate PIP burn (only if discount is applied)
  IF v_credit_savings > 0.0 THEN
    v_pip_to_burn := CEIL(v_credit_savings * 10.0 * 100.0) / 100.0;

    SELECT COALESCE(available_tokens, 0) INTO v_pip_available
    FROM club_token_balances WHERE user_id = p_user_id;

    IF v_pip_available IS NULL THEN v_pip_available := 0; END IF;

    IF v_pip_available < v_pip_to_burn THEN
      v_degraded := true;
      v_credit_savings := 0.0;
      v_final_cost := v_base_cost;
      v_pip_to_burn := 0.0;
      v_discount_pct := 0.0;
    END IF;
  END IF;

  -- Check credit balance (SSOT: column is `balance` not `credit_balance`)
  SELECT COALESCE(balance, 0) INTO v_credit_balance
  FROM user_token_balance WHERE user_id = p_user_id;

  IF v_credit_balance IS NULL THEN v_credit_balance := 0; END IF;

  IF v_credit_balance < v_final_cost THEN
    v_quote_id := gen_random_uuid();
    INSERT INTO trade_cost_quotes (
      id, user_id, trade_intent_id, membership_tier, tier_name,
      discount_pct, base_credit_cost, credit_discount_amount,
      final_credit_cost, pip_to_burn, status, reject_reason, degraded, expires_at
    ) VALUES (
      v_quote_id, p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
      v_discount_pct, v_base_cost, v_credit_savings,
      v_final_cost, v_pip_to_burn, 'rejected', 'INSUFFICIENT_CREDITS', v_degraded,
      now() + interval '5 minutes'
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'quote_id', v_quote_id,
      'reason', 'INSUFFICIENT_CREDITS',
      'required', v_final_cost,
      'available', v_credit_balance,
      'base_credit_cost', v_base_cost,
      'discount_pct', v_discount_pct,
      'membership_tier', v_tier_level,
      'tier_name', v_tier_name,
      'degraded', v_degraded
    );
  END IF;

  -- Insufficient PIP with discount degradation
  IF v_degraded = true AND v_credit_balance < v_final_cost THEN
    v_quote_id := gen_random_uuid();
    INSERT INTO trade_cost_quotes (
      id, user_id, trade_intent_id, membership_tier, tier_name,
      discount_pct, base_credit_cost, credit_discount_amount,
      final_credit_cost, pip_to_burn, status, reject_reason, degraded, expires_at
    ) VALUES (
      v_quote_id, p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
      0.0, v_base_cost, 0.0,
      v_base_cost, 0.0, 'rejected', 'INSUFFICIENT_CREDITS_NO_DISCOUNT', true,
      now() + interval '5 minutes'
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'quote_id', v_quote_id,
      'reason', 'INSUFFICIENT_CREDITS_NO_DISCOUNT',
      'required', v_base_cost,
      'available', v_credit_balance,
      'degraded', true
    );
  END IF;

  -- Create approved quote
  v_quote_id := gen_random_uuid();
  INSERT INTO trade_cost_quotes (
    id, user_id, trade_intent_id, membership_tier, tier_name,
    discount_pct, base_credit_cost, credit_discount_amount,
    final_credit_cost, pip_to_burn, status, degraded, expires_at
  ) VALUES (
    v_quote_id, p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
    v_discount_pct, v_base_cost, v_credit_savings,
    v_final_cost, v_pip_to_burn, 'approved', v_degraded,
    now() + interval '5 minutes'
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
$function$;

GRANT EXECUTE ON FUNCTION public.quote_trade_cost(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_trade_cost(uuid, uuid) TO service_role;

-- STEP 4: Unblock all incorrectly credit-blocked sessions
UPDATE goal_sessions
SET credit_blocked = false,
    pending_credit_intent_id = NULL
WHERE credit_blocked = true;
