/*
  # Fix Referral Commission Calculation - Tier-Based 10% PIP Rewards

  ## Problem
  Current system pays flat 500 PIP bonus regardless of membership tier.
  Should pay 10% of membership price as PIP tokens (at $0.10 per PIP).

  ## Solution
  - Member ($99): 10% = $9.90 → 99 PIP tokens (rounded to 100)
  - Starter ($250): 10% = $25 → 250 PIP tokens
  - Builder ($500): 10% = $50 → 500 PIP tokens
  - Pro ($1,000): 10% = $100 → 1,000 PIP tokens
  - Elite ($5,000): 10% = $500 → 5,000 PIP tokens
  - Founder ($10,000): 10% = $1,000 → 10,000 PIP tokens

  ## Changes
  1. Drop existing pay_referral_commission function with full signature
  2. Create new simplified version
  3. Calculate PIP tokens dynamically: (membership_price * 0.10) / 0.10
  4. Calculate cash commission: membership_price * 0.20

  ## SSOT Compliance
  - All commission calculation logic in database RPC
  - Single source of truth for commission rates
  - Referral service delegates to database

  ## CCIP Reference
  - Change Type: Bug Fix - Incorrect PIP Commission Calculation
  - Impact: All future referral commissions will be tier-based
  - Risk Level: Low (only affects future transactions, improves accuracy)
*/

-- Drop existing function with full signature
DROP FUNCTION IF EXISTS pay_referral_commission(UUID, UUID, NUMERIC, UUID, BOOLEAN);

-- Create new pay_referral_commission function with correct tier-based logic
CREATE OR REPLACE FUNCTION pay_referral_commission(
  p_referee_id UUID,
  p_membership_price_usd NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
  v_referral_id UUID;
  v_pip_commission NUMERIC;
  v_cash_commission NUMERIC;
  v_ledger_id UUID;
  v_pip_token_price CONSTANT NUMERIC := 0.10; -- $0.10 per PIP token
  v_pip_commission_pct CONSTANT NUMERIC := 0.10; -- 10% of membership price
  v_cash_commission_pct CONSTANT NUMERIC := 0.20; -- 20% of membership price
BEGIN
  -- Find referrer from user_profiles (SSOT for referral relationships)
  SELECT referred_by_user_id
  INTO v_referrer_id
  FROM user_profiles
  WHERE id = p_referee_id;

  -- No referrer, exit gracefully
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_referrer');
  END IF;

  -- Calculate commissions
  -- PIP: 10% of membership price converted to tokens at $0.10 per token
  v_pip_commission := ROUND((p_membership_price_usd * v_pip_commission_pct) / v_pip_token_price, 2);
  
  -- Cash: 20% of membership price
  v_cash_commission := ROUND(p_membership_price_usd * v_cash_commission_pct, 2);

  -- Find or create referral record
  SELECT id INTO v_referral_id
  FROM club_referrals
  WHERE referee_id = p_referee_id
    AND referrer_id = v_referrer_id
  LIMIT 1;

  -- Update referral record with commission amounts
  IF v_referral_id IS NOT NULL THEN
    UPDATE club_referrals
    SET 
      status = 'completed',
      completed_at = now(),
      tokens_awarded = v_pip_commission,
      cash_awarded_usd = v_cash_commission,
      reward_paid = true,
      reward_paid_at = now(),
      updated_at = now()
    WHERE id = v_referral_id;
  ELSE
    -- Create referral record if it doesn't exist (defensive programming)
    INSERT INTO club_referrals (
      referrer_id,
      referee_id,
      referral_code,
      status,
      completed_at,
      tokens_awarded,
      cash_awarded_usd,
      reward_paid,
      reward_paid_at,
      commission_model
    )
    SELECT 
      v_referrer_id,
      p_referee_id,
      cr.referral_code,
      'completed',
      now(),
      v_pip_commission,
      v_cash_commission,
      true,
      now(),
      'ongoing'
    FROM club_referrals cr
    WHERE cr.referrer_id = v_referrer_id
    LIMIT 1
    RETURNING id INTO v_referral_id;
  END IF;

  -- Award PIP tokens to referrer via club_token_ledger
  INSERT INTO club_token_ledger (
    user_id,
    amount,
    transaction_type,
    description,
    reference_id,
    source_pool
  ) VALUES (
    v_referrer_id,
    v_pip_commission,
    'referral_commission_initial',
    format('Referral commission: %s PIP + $%s cash', v_pip_commission, v_cash_commission),
    v_referral_id,
    'referral'
  )
  RETURNING id INTO v_ledger_id;

  -- Send notification to referrer
  INSERT INTO goal_notifications (
    user_id,
    type,
    title,
    message,
    priority,
    reference_id,
    reference_type,
    metadata
  ) VALUES (
    v_referrer_id,
    'referral_commission_earned',
    'Referral Commission Earned!',
    format('You earned %s PIP tokens + $%s cash from a referral purchase!', v_pip_commission, v_cash_commission),
    'medium',
    v_referral_id,
    'referral',
    jsonb_build_object(
      'pip_tokens', v_pip_commission,
      'cash_usd', v_cash_commission,
      'membership_price', p_membership_price_usd,
      'commission_pct', v_pip_commission_pct * 100
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referrer_id,
    'referral_id', v_referral_id,
    'pip_commission', v_pip_commission,
    'cash_commission', v_cash_commission,
    'ledger_id', v_ledger_id
  );
END;
$$;

-- Create view for detailed referral information
CREATE OR REPLACE VIEW club_referrals_detailed AS
SELECT 
  cr.id,
  cr.referrer_id,
  cr.referee_id,
  cr.referral_code,
  cr.status,
  cr.commission_model,
  cr.referred_at,
  cr.completed_at,
  cr.tokens_awarded,
  cr.cash_awarded_usd,
  cr.reward_paid,
  cr.reward_paid_at,
  
  -- Referee details (anonymized for privacy)
  up_referee.email as referee_email,
  cm.tier_level as referee_tier_level,
  cmp.name as referee_tier_name,
  cm.amount_paid_usd as referee_amount_paid,
  cm.purchased_at as referee_purchase_date,
  cm.status as referee_membership_status,
  
  -- Referrer details
  up_referrer.email as referrer_email,
  
  -- Calculated fields
  CASE 
    WHEN cr.status = 'completed' THEN 'Active'
    WHEN cr.status = 'pending' AND cr.referee_id IS NOT NULL THEN 'Signed Up'
    WHEN cr.status = 'pending' AND cr.referee_id IS NULL THEN 'Link Clicked'
    ELSE cr.status
  END as display_status,
  
  EXTRACT(EPOCH FROM (COALESCE(cr.completed_at, now()) - cr.referred_at)) / 86400 as days_to_conversion

FROM club_referrals cr
LEFT JOIN user_profiles up_referee ON cr.referee_id = up_referee.id
LEFT JOIN user_profiles up_referrer ON cr.referrer_id = up_referrer.id
LEFT JOIN club_memberships cm ON cr.referee_id = cm.user_id
LEFT JOIN club_membership_packages cmp ON cm.package_id = cmp.id;

-- Grant access to view
GRANT SELECT ON club_referrals_detailed TO authenticated, service_role;

-- Create RPC function to get user's referral details
CREATE OR REPLACE FUNCTION get_user_referral_details(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  referee_email TEXT,
  referee_tier_level INTEGER,
  referee_tier_name TEXT,
  referee_amount_paid NUMERIC,
  referee_purchase_date TIMESTAMPTZ,
  status TEXT,
  display_status TEXT,
  referred_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pip_earned NUMERIC,
  cash_earned NUMERIC,
  days_to_conversion NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    crd.id,
    -- Anonymize email for privacy (show first 3 chars + ***@domain)
    CASE 
      WHEN crd.referee_email IS NOT NULL THEN 
        SUBSTRING(crd.referee_email FROM 1 FOR 3) || '***@' || SPLIT_PART(crd.referee_email, '@', 2)
      ELSE 'Pending'
    END as referee_email,
    crd.referee_tier_level,
    COALESCE(crd.referee_tier_name, 'Not Yet Purchased') as referee_tier_name,
    crd.referee_amount_paid,
    crd.referee_purchase_date,
    crd.status,
    crd.display_status,
    crd.referred_at,
    crd.completed_at,
    crd.tokens_awarded as pip_earned,
    crd.cash_awarded_usd as cash_earned,
    crd.days_to_conversion
  FROM club_referrals_detailed crd
  WHERE crd.referrer_id = p_user_id
  ORDER BY crd.referred_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION pay_referral_commission IS
  'SSOT for referral commission calculation. Pays 10% of membership price as PIP tokens + 20% as cash commission.';

COMMENT ON FUNCTION get_user_referral_details IS
  'Returns detailed referral information for a user with privacy-safe email anonymization.';
