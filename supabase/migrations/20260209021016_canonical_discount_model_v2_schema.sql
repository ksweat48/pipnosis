/*
  # Canonical Discount Model v2 — Schema Updates

  1. Modified Tables
    - `club_membership_packages`
      - Added `discount_pct` NUMERIC(5,4) column for percentage-based discounts
      - Updated all 6 canonical tiers with new discount_pct values
      - Updated credit_discount to match new effective savings
      - Updated benefits arrays with new discount wording
    - `club_token_ledger`
      - Updated transaction_type CHECK constraint to include 'discount_burn'
      - Updated reference_type CHECK constraint to include 'discount'

  2. Updated RPCs
    - `get_user_credit_discount` now returns discount_pct alongside credit_discount

  3. Security
    - No RLS changes (existing policies remain)

  4. Important Notes
    - This migration implements the LOCKED canonical tier discount table:
      Member=0%, Starter=0%, Builder=5%, Pro=10%, Elite=15%, Founder=20%
    - Maximum discount is 20% (Founder), minimum trade cost is 8 credits
    - PIP tokens are burned when discounts are applied (10 PIP per credit saved)
    - Stale tiers 7-9 (Bronze, Silver, Gold) are deactivated
*/

-- Step 1: Add discount_pct column to club_membership_packages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_membership_packages' AND column_name = 'discount_pct'
  ) THEN
    ALTER TABLE club_membership_packages ADD COLUMN discount_pct NUMERIC(5,4) DEFAULT 0.0000;
  END IF;
END $$;

-- Step 2: Update canonical tiers with new discount percentages and benefits
UPDATE club_membership_packages
SET discount_pct = 0.0000,
    credit_discount = 0,
    benefits = '["Access to Pipnosis Club", "100 PIP Access Tokens", "Community trader chat", "View platform growth & token metrics"]'::jsonb,
    updated_at = now()
WHERE tier_level = 1 AND name = 'Member';

UPDATE club_membership_packages
SET discount_pct = 0.0000,
    credit_discount = 0,
    benefits = '["Club access", "250 PIP Access Tokens", "Market Analyzer access", "Community trader chat", "Club dashboards"]'::jsonb,
    updated_at = now()
WHERE tier_level = 2 AND name = 'Starter';

UPDATE club_membership_packages
SET discount_pct = 0.0500,
    credit_discount = 1,
    benefits = '["Club access", "500 PIP Access Tokens", "Staking rewards enabled", "5% trade discount (9.5 credits/trade)", "Market Analyzer", "Community chat"]'::jsonb,
    updated_at = now()
WHERE tier_level = 3 AND name = 'Builder';

UPDATE club_membership_packages
SET discount_pct = 0.1000,
    credit_discount = 1,
    benefits = '["Club access", "1,000 PIP Access Tokens", "Higher staking reward multiplier", "10% trade discount (9 credits/trade)", "Advanced Market Analyzer", "Voting rights", "+5% referral bonus", "Community + Pro-only channels"]'::jsonb,
    updated_at = now()
WHERE tier_level = 4 AND name = 'Pro';

UPDATE club_membership_packages
SET discount_pct = 0.1500,
    credit_discount = 2,
    benefits = '["Club access", "5,000 PIP Access Tokens", "Enhanced staking rewards", "15% trade discount (8.5 credits/trade)", "Higher voting weight", "+10% referral bonus", "VIP access to events", "Early platform announcements", "Elite-only channels"]'::jsonb,
    updated_at = now()
WHERE tier_level = 5 AND name = 'Elite Partner';

UPDATE club_membership_packages
SET discount_pct = 0.2000,
    credit_discount = 2,
    benefits = '["Club access", "10,000 PIP Access Tokens", "Maximum staking rewards", "20% trade discount (8 credits/trade)", "Highest voting weight", "+15% referral bonus", "VIP + private Founder events", "Founder vacation bonus", "Exclusive Founders Circle access", "First access to roadmap + alpha features"]'::jsonb,
    updated_at = now()
WHERE tier_level = 6 AND name = 'Founder';

-- Step 3: Deactivate stale tiers 7-9
UPDATE club_membership_packages
SET is_active = false, updated_at = now()
WHERE tier_level IN (7, 8, 9);

-- Step 4: Update club_token_ledger transaction_type constraint
ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS club_token_ledger_transaction_type_check;
ALTER TABLE club_token_ledger ADD CONSTRAINT club_token_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'membership_purchase', 'referral_reward', 'staking_reward',
    'admin_grant', 'admin_deduct', 'cashout_deduction',
    'promotion_bonus', 'migration_adjustment',
    'discount_burn', 'staking_lock', 'staking_unlock'
  ));

-- Step 5: Update club_token_ledger reference_type constraint
ALTER TABLE club_token_ledger DROP CONSTRAINT IF EXISTS club_token_ledger_reference_type_check;
ALTER TABLE club_token_ledger ADD CONSTRAINT club_token_ledger_reference_type_check
  CHECK (reference_type IN (
    'membership', 'referral', 'cashout', 'staking',
    'admin_action', 'promotion', 'discount'
  ));

-- Step 6: Drop and recreate get_user_credit_discount RPC with discount_pct
DROP FUNCTION IF EXISTS get_user_credit_discount(UUID);

CREATE FUNCTION get_user_credit_discount(p_user_id UUID)
RETURNS TABLE(
  credit_discount INTEGER,
  discount_pct NUMERIC,
  tier_level INTEGER,
  tier_name TEXT,
  staking_enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
RETURN QUERY
SELECT
  COALESCE(pkg.credit_discount, 0),
  COALESCE(pkg.discount_pct, 0.0000)::NUMERIC,
  COALESCE(m.tier_level, 0),
  COALESCE(pkg.name, 'None'::TEXT),
  COALESCE(pkg.staking_enabled, false)
FROM club_memberships m
JOIN club_membership_packages pkg ON pkg.id = m.package_id
WHERE m.user_id = p_user_id
  AND m.status = 'active'
  AND pkg.is_active = true
LIMIT 1;
END;
$$;
