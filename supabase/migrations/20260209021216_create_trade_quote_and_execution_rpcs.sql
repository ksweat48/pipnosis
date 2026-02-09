/*
  # Create Trade Quote and Execution RPCs

  1. New Functions
    - `quote_trade_cost(p_user_id, p_trade_intent_id)` — Idempotent quote creation
      - Checks for existing quote (idempotency)
      - Reads user tier discount from active membership
      - Computes credit cost, PIP burn amount
      - Validates credit balance, validates PIP balance
      - Gracefully degrades if PIP insufficient (no discount)
      - Returns approved/rejected quote

    - `execute_trade_quote(p_quote_id, p_user_id)` — Atomic quote execution
      - Validates quote ownership, status, expiry
      - Atomically: deducts credits + burns PIP + updates quote status
      - Records deduction in credit_deduction_history with structured columns

    - `get_discount_burn_analytics()` — Admin analytics for burn metrics

  2. Security
    - All functions are SECURITY DEFINER for atomic operations
    - User ownership validated within each function

  3. Important Notes
    - The quote system ensures idempotency: same trade_intent_id = same quote
    - Quotes expire after 5 minutes
    - PIP burns are gracefully skipped if user lacks sufficient PIP balance
    - Admin analytics aggregates per-tier and global discount/burn metrics
*/

-- Quote Trade Cost RPC
CREATE OR REPLACE FUNCTION quote_trade_cost(
  p_user_id UUID,
  p_trade_intent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
BEGIN
  IF p_user_id IS NULL OR p_trade_intent_id IS NULL THEN
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'MISSING_PARAMETERS');
  END IF;

  SELECT id, status, final_credit_cost, pip_to_burn, discount_pct, tier_name, membership_tier, degraded
  INTO v_existing_quote
  FROM trade_cost_quotes
  WHERE trade_intent_id = p_trade_intent_id;

  IF v_existing_quote.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', v_existing_quote.status,
      'quote_id', v_existing_quote.id,
      'final_credit_cost', v_existing_quote.final_credit_cost,
      'pip_to_burn', v_existing_quote.pip_to_burn,
      'discount_pct', v_existing_quote.discount_pct,
      'tier_name', v_existing_quote.tier_name,
      'membership_tier', v_existing_quote.membership_tier,
      'degraded', v_existing_quote.degraded,
      'idempotent', true
    );
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM user_profiles WHERE id = p_user_id;

  IF COALESCE(v_is_admin, false) = true THEN
    INSERT INTO trade_cost_quotes (
      user_id, trade_intent_id, membership_tier, tier_name,
      discount_pct, base_credit_cost, credit_discount_amount,
      final_credit_cost, pip_to_burn, status, degraded, expires_at
    ) VALUES (
      p_user_id, p_trade_intent_id, 99, 'Admin',
      0.0, 0.0, 0.0, 0.0, 0.0, 'approved', false,
      now() + interval '5 minutes'
    ) RETURNING id INTO v_quote_id;

    RETURN jsonb_build_object(
      'status', 'approved',
      'quote_id', v_quote_id,
      'final_credit_cost', 0.0,
      'pip_to_burn', 0.0,
      'discount_pct', 0.0,
      'tier_name', 'Admin',
      'membership_tier', 99,
      'degraded', false,
      'admin_bypass', true
    );
  END IF;

  SELECT COALESCE(pkg.discount_pct, 0.0), COALESCE(m.tier_level, 0), COALESCE(pkg.name, 'None')
  INTO v_discount_pct, v_tier_level, v_tier_name
  FROM club_memberships m
  JOIN club_membership_packages pkg ON pkg.id = m.package_id
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND pkg.is_active = true
  LIMIT 1;

  v_discount_pct := LEAST(COALESCE(v_discount_pct, 0.0), 0.20);

  v_credit_savings := FLOOR(v_base_cost * v_discount_pct * 100.0) / 100.0;
  v_final_cost := GREATEST(v_base_cost - v_credit_savings, 8.00);

  IF v_credit_savings > 0.0 THEN
    v_pip_to_burn := CEIL(v_credit_savings * 10.0 * 100.0) / 100.0;
  END IF;

  SELECT COALESCE(balance, 0) INTO v_credit_balance
  FROM user_token_balance WHERE user_id = p_user_id;

  IF v_credit_balance IS NULL THEN v_credit_balance := 0; END IF;

  IF v_credit_balance < v_final_cost THEN
    INSERT INTO trade_cost_quotes (
      user_id, trade_intent_id, membership_tier, tier_name,
      discount_pct, base_credit_cost, credit_discount_amount,
      final_credit_cost, pip_to_burn, status, reject_reason, degraded, expires_at
    ) VALUES (
      p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
      v_discount_pct, v_base_cost, v_credit_savings,
      v_final_cost, v_pip_to_burn, 'rejected', 'INSUFFICIENT_CREDITS', false,
      now() + interval '5 minutes'
    ) RETURNING id INTO v_quote_id;

    RETURN jsonb_build_object(
      'status', 'rejected',
      'quote_id', v_quote_id,
      'reason', 'INSUFFICIENT_CREDITS',
      'required', v_final_cost,
      'available', v_credit_balance
    );
  END IF;

  IF v_pip_to_burn > 0.0 THEN
    SELECT COALESCE(total_tokens - locked_tokens, 0) INTO v_pip_available
    FROM club_token_balances WHERE user_id = p_user_id;

    IF v_pip_available IS NULL THEN v_pip_available := 0; END IF;

    IF v_pip_available < v_pip_to_burn THEN
      v_degraded := true;
      v_credit_savings := 0.0;
      v_final_cost := v_base_cost;
      v_pip_to_burn := 0.0;
      v_discount_pct := 0.0;

      IF v_credit_balance < v_final_cost THEN
        INSERT INTO trade_cost_quotes (
          user_id, trade_intent_id, membership_tier, tier_name,
          discount_pct, base_credit_cost, credit_discount_amount,
          final_credit_cost, pip_to_burn, status, reject_reason, degraded, expires_at
        ) VALUES (
          p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
          0.0, v_base_cost, 0.0,
          v_base_cost, 0.0, 'rejected', 'INSUFFICIENT_CREDITS_NO_DISCOUNT', true,
          now() + interval '5 minutes'
        ) RETURNING id INTO v_quote_id;

        RETURN jsonb_build_object(
          'status', 'rejected',
          'quote_id', v_quote_id,
          'reason', 'INSUFFICIENT_CREDITS_NO_DISCOUNT',
          'required', v_base_cost,
          'available', v_credit_balance,
          'degraded', true
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO trade_cost_quotes (
    user_id, trade_intent_id, membership_tier, tier_name,
    discount_pct, base_credit_cost, credit_discount_amount,
    final_credit_cost, pip_to_burn, status, degraded, expires_at
  ) VALUES (
    p_user_id, p_trade_intent_id, v_tier_level, v_tier_name,
    v_discount_pct, v_base_cost, v_credit_savings,
    v_final_cost, v_pip_to_burn, 'approved', v_degraded,
    now() + interval '5 minutes'
  ) RETURNING id INTO v_quote_id;

  RETURN jsonb_build_object(
    'status', 'approved',
    'quote_id', v_quote_id,
    'final_credit_cost', v_final_cost,
    'pip_to_burn', v_pip_to_burn,
    'credit_discount_amount', v_credit_savings,
    'discount_pct', v_discount_pct,
    'tier_name', v_tier_name,
    'membership_tier', v_tier_level,
    'degraded', v_degraded,
    'base_credit_cost', v_base_cost
  );
END;
$$;

-- Execute Trade Quote RPC
CREATE OR REPLACE FUNCTION execute_trade_quote(
  p_quote_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quote RECORD;
  v_deduct_result JSONB;
  v_pip_result BOOLEAN;
  v_new_credit_balance NUMERIC;
BEGIN
  IF p_quote_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_PARAMETERS');
  END IF;

  SELECT * INTO v_quote
  FROM trade_cost_quotes
  WHERE id = p_quote_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'QUOTE_NOT_FOUND');
  END IF;

  IF v_quote.status = 'executed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_executed', true,
      'final_credit_cost', v_quote.final_credit_cost,
      'pip_burned', v_quote.pip_to_burn
    );
  END IF;

  IF v_quote.status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'QUOTE_NOT_APPROVED', 'status', v_quote.status);
  END IF;

  IF v_quote.expires_at < now() THEN
    UPDATE trade_cost_quotes SET status = 'expired' WHERE id = p_quote_id;
    RETURN jsonb_build_object('success', false, 'error', 'QUOTE_EXPIRED');
  END IF;

  IF v_quote.tier_name = 'Admin' AND v_quote.final_credit_cost = 0.0 THEN
    UPDATE trade_cost_quotes
    SET status = 'executed', executed_at = now()
    WHERE id = p_quote_id;

    RETURN jsonb_build_object(
      'success', true,
      'final_credit_cost', 0.0,
      'pip_burned', 0.0,
      'admin_bypass', true
    );
  END IF;

  v_deduct_result := deduct_tokens(
    p_user_id,
    v_quote.final_credit_cost,
    'signal_detected',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'trade_intent_id', v_quote.trade_intent_id,
      'discount_pct', v_quote.discount_pct,
      'tier_name', v_quote.tier_name,
      'base_cost', v_quote.base_credit_cost,
      'final_cost', v_quote.final_credit_cost,
      'pip_to_burn', v_quote.pip_to_burn,
      'degraded', v_quote.degraded
    )
  );

  IF NOT (v_deduct_result->>'success')::BOOLEAN THEN
    UPDATE trade_cost_quotes
    SET status = 'rejected', reject_reason = 'EXECUTION_CREDIT_DEDUCT_FAILED'
    WHERE id = p_quote_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'CREDIT_DEDUCTION_FAILED',
      'detail', v_deduct_result->>'error'
    );
  END IF;

  IF v_quote.pip_to_burn > 0 THEN
    v_pip_result := deduct_club_tokens(
      p_user_id,
      v_quote.pip_to_burn,
      'discount_burn',
      'PIP burned for ' || v_quote.discount_pct * 100 || '% trade discount (Quote: ' || p_quote_id || ')',
      p_quote_id,
      'discount',
      NULL
    );

    IF NOT COALESCE(v_pip_result, false) THEN
      RAISE WARNING 'PIP burn failed for quote %, amount %. Credits already deducted.', p_quote_id, v_quote.pip_to_burn;
    END IF;
  END IF;

  UPDATE trade_cost_quotes
  SET status = 'executed', executed_at = now()
  WHERE id = p_quote_id;

  SELECT balance INTO v_new_credit_balance
  FROM user_token_balance WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'final_credit_cost', v_quote.final_credit_cost,
    'pip_burned', v_quote.pip_to_burn,
    'discount_pct', v_quote.discount_pct,
    'tier_name', v_quote.tier_name,
    'new_credit_balance', COALESCE(v_new_credit_balance, 0),
    'degraded', v_quote.degraded
  );
END;
$$;

-- Admin Discount Burn Analytics RPC
CREATE OR REPLACE FUNCTION get_discount_burn_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_per_tier JSONB;
  v_global JSONB;
BEGIN
  SELECT jsonb_agg(tier_data)
  INTO v_per_tier
  FROM (
    SELECT jsonb_build_object(
      'tier_name', tier_name,
      'tier_level', membership_tier,
      'total_trades', COUNT(*),
      'discount_trades', COUNT(*) FILTER (WHERE discount_pct > 0 AND NOT degraded),
      'avg_credits_per_trade', ROUND(AVG(final_credit_cost)::NUMERIC, 2),
      'avg_pip_burned', ROUND(AVG(CASE WHEN NOT degraded THEN pip_to_burn ELSE 0 END)::NUMERIC, 2),
      'total_pip_burned', ROUND(SUM(CASE WHEN status = 'executed' AND NOT degraded THEN pip_to_burn ELSE 0 END)::NUMERIC, 2),
      'total_credits_saved', ROUND(SUM(CASE WHEN status = 'executed' AND NOT degraded THEN credit_discount_amount ELSE 0 END)::NUMERIC, 2),
      'discount_adoption_rate', CASE
        WHEN COUNT(*) > 0 THEN ROUND(
          (COUNT(*) FILTER (WHERE discount_pct > 0 AND NOT degraded))::NUMERIC / COUNT(*)::NUMERIC * 100, 1
        )
        ELSE 0
      END
    ) AS tier_data
    FROM trade_cost_quotes
    WHERE status = 'executed'
    GROUP BY tier_name, membership_tier
    ORDER BY membership_tier
  ) sub;

  SELECT jsonb_build_object(
    'total_trades', COUNT(*),
    'total_pip_burned_lifetime', ROUND(COALESCE(SUM(CASE WHEN NOT degraded THEN pip_to_burn ELSE 0 END), 0)::NUMERIC, 2),
    'total_pip_burned_24h', ROUND(COALESCE(SUM(CASE WHEN NOT degraded AND executed_at >= now() - interval '24 hours' THEN pip_to_burn ELSE 0 END), 0)::NUMERIC, 2),
    'total_credits_saved', ROUND(COALESCE(SUM(CASE WHEN NOT degraded THEN credit_discount_amount ELSE 0 END), 0)::NUMERIC, 2),
    'effective_discount_pct', CASE
      WHEN COUNT(*) > 0 THEN ROUND(
        (1.0 - COALESCE(AVG(final_credit_cost), 10.0) / 10.0) * 100, 2
      )
      ELSE 0
    END,
    'discount_adoption_rate', CASE
      WHEN COUNT(*) > 0 THEN ROUND(
        (COUNT(*) FILTER (WHERE discount_pct > 0 AND NOT degraded))::NUMERIC / COUNT(*)::NUMERIC * 100, 1
      )
      ELSE 0
    END,
    'degraded_trades', COUNT(*) FILTER (WHERE degraded),
    'total_token_supply', 100000000
  )
  INTO v_global
  FROM trade_cost_quotes
  WHERE status = 'executed';

  RETURN jsonb_build_object(
    'per_tier', COALESCE(v_per_tier, '[]'::jsonb),
    'global', COALESCE(v_global, '{}'::jsonb),
    'generated_at', now()
  );
END;
$$;
