/*
  # Canonical Tokenomics v1.2.1 -- Foundation Migration

  ## Summary
  Implements foundational data layer changes for Canonical Tokenomics v1.2.1.

  ## Changes
  1. Fractional Token Accounting - INTEGER to NUMERIC(12,2)
  2. New Membership Package Columns (credit_discount, staking, voting)
  3. New 6-Tier Membership Packages (Member through Founder)
  4. Staking Positions Table with RLS
  5. RPC Function Updates for NUMERIC types
  6. New get_user_credit_discount RPC for trade execution
*/

-- ============================================================
-- PART 1: Convert INTEGER columns to NUMERIC(12,2)
-- ============================================================

ALTER TABLE club_token_balances DROP COLUMN IF EXISTS available_tokens;

ALTER TABLE club_token_balances
  ALTER COLUMN total_tokens TYPE NUMERIC(12,2) USING total_tokens::NUMERIC(12,2),
  ALTER COLUMN locked_tokens TYPE NUMERIC(12,2) USING locked_tokens::NUMERIC(12,2),
  ALTER COLUMN lifetime_earned TYPE NUMERIC(12,2) USING lifetime_earned::NUMERIC(12,2),
  ALTER COLUMN lifetime_spent TYPE NUMERIC(12,2) USING lifetime_spent::NUMERIC(12,2),
  ALTER COLUMN staked_tokens TYPE NUMERIC(12,2) USING staked_tokens::NUMERIC(12,2),
  ALTER COLUMN reward_tokens_pending TYPE NUMERIC(12,2) USING reward_tokens_pending::NUMERIC(12,2);

ALTER TABLE club_token_balances
  ADD COLUMN available_tokens NUMERIC(12,2) GENERATED ALWAYS AS (total_tokens - locked_tokens) STORED;

ALTER TABLE club_token_ledger
  ALTER COLUMN amount TYPE NUMERIC(12,2) USING amount::NUMERIC(12,2),
  ALTER COLUMN balance_after TYPE NUMERIC(12,2) USING balance_after::NUMERIC(12,2);

ALTER TABLE club_referrals
  ALTER COLUMN tokens_awarded TYPE NUMERIC(12,2) USING tokens_awarded::NUMERIC(12,2);

ALTER TABLE club_referral_stats
  ALTER COLUMN total_tokens_earned TYPE NUMERIC(12,2) USING total_tokens_earned::NUMERIC(12,2);

ALTER TABLE club_membership_packages
  ALTER COLUMN initial_token_allocation TYPE NUMERIC(12,2) USING initial_token_allocation::NUMERIC(12,2),
  ALTER COLUMN required_token_balance TYPE NUMERIC(12,2) USING required_token_balance::NUMERIC(12,2);

ALTER TABLE club_memberships
  ALTER COLUMN tokens_locked TYPE NUMERIC(12,2) USING tokens_locked::NUMERIC(12,2);

-- ============================================================
-- PART 2: Add new columns to club_membership_packages
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'club_membership_packages' AND column_name = 'credit_discount') THEN
    ALTER TABLE club_membership_packages ADD COLUMN credit_discount INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'club_membership_packages' AND column_name = 'staking_enabled') THEN
    ALTER TABLE club_membership_packages ADD COLUMN staking_enabled BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'club_membership_packages' AND column_name = 'voting_enabled') THEN
    ALTER TABLE club_membership_packages ADD COLUMN voting_enabled BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'club_membership_packages' AND column_name = 'voting_weight') THEN
    ALTER TABLE club_membership_packages ADD COLUMN voting_weight NUMERIC(4,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'club_membership_packages' AND column_name = 'referral_bonus_pct') THEN
    ALTER TABLE club_membership_packages ADD COLUMN referral_bonus_pct INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================================
-- PART 3: Deactivate old packages, insert new 6-tier
-- ============================================================

UPDATE club_membership_packages SET is_active = false WHERE name IN ('Bronze Member', 'Silver Member', 'Gold Member');

INSERT INTO club_membership_packages (
  name, description, tier_level, price_usd, initial_token_allocation, required_token_balance,
  benefits, badge_color, badge_icon, is_active, display_order,
  governance_weight, staking_boost_multiplier,
  credit_discount, staking_enabled, voting_enabled, voting_weight, referral_bonus_pct
) VALUES
  ('Member', 'Entry into the Pipnosis ecosystem with Club access and community features.', 1, 99.00, 100, 100,
   '["Access to Pipnosis Club", "100 PIP Access Tokens", "Community trader chat", "View platform growth & token metrics"]'::jsonb,
   '#64748b', 'user', true, 1, 0, 0, 0, false, false, 0, 0),
  ('Starter', 'Early utility access with analysis tools and Club dashboards.', 2, 250.00, 250, 250,
   '["Club access", "250 PIP Access Tokens", "Market Analyzer access", "Community trader chat", "Club dashboards"]'::jsonb,
   '#0ea5e9', 'rocket', true, 2, 0, 0, 0, false, false, 0, 0),
  ('Builder', 'Unlock staking rewards and trading efficiency with credit discounts.', 3, 500.00, 500, 500,
   '["Club access", "500 PIP Access Tokens", "Staking rewards enabled", "1 credit discount per trade (9 credits/trade)", "Market Analyzer", "Community chat"]'::jsonb,
   '#f59e0b', 'hammer', true, 3, 1.0, 1.0, 1, true, false, 0, 0),
  ('Pro', 'Serious trader tier with higher staking multipliers, voting rights, and bigger discounts.', 4, 1000.00, 1000, 1000,
   '["Club access", "1,000 PIP Access Tokens", "Higher staking reward multiplier", "2 credit discount per trade (8 credits/trade)", "Advanced Market Analyzer", "Voting rights", "+5% referral bonus", "Community + Pro-only channels"]'::jsonb,
   '#8b5cf6', 'zap', true, 4, 1.0, 1.5, 2, true, true, 1.0, 5),
  ('Elite Partner', 'Growth partner and ecosystem amplifier with enhanced rewards and governance power.', 5, 5000.00, 5000, 5000,
   '["Club access", "5,000 PIP Access Tokens", "Enhanced staking rewards", "3 credit discount per trade (7 credits/trade)", "Higher voting weight", "+10% referral bonus", "VIP access to events", "Early platform announcements", "Elite-only channels"]'::jsonb,
   '#059669', 'shield', true, 5, 2.0, 2.0, 3, true, true, 2.0, 10),
  ('Founder', 'Long-term strategic backer with maximum benefits, staking, governance, and exclusive access.', 6, 10000.00, 10000, 10000,
   '["Club access", "10,000 PIP Access Tokens", "Maximum staking rewards", "4 credit discount per trade (6 credits/trade)", "Highest voting weight", "+15% referral bonus", "VIP + private Founder events", "Founder vacation bonus", "Exclusive Founders Circle access", "First access to roadmap + alpha features"]'::jsonb,
   '#dc2626', 'crown', true, 6, 3.0, 3.0, 4, true, true, 3.0, 15)
ON CONFLICT DO NOTHING;

-- ============================================================
-- PART 4: Create staking positions table
-- ============================================================

CREATE TABLE IF NOT EXISTS club_staking_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  amount_staked NUMERIC(12,2) NOT NULL,
  staked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlock_at TIMESTAMPTZ NOT NULL,
  duration_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tier_weight NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  rewards_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_reward_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_staking_status CHECK (status IN ('active', 'unlocked', 'cancelled'))
);

ALTER TABLE club_staking_positions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'club_staking_positions' AND policyname = 'Users can view own staking positions') THEN
    CREATE POLICY "Users can view own staking positions" ON club_staking_positions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'club_staking_positions' AND policyname = 'Users can insert own staking positions') THEN
    CREATE POLICY "Users can insert own staking positions" ON club_staking_positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'club_staking_positions' AND policyname = 'Users can update own staking positions') THEN
    CREATE POLICY "Users can update own staking positions" ON club_staking_positions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'club_staking_positions' AND policyname = 'Service role full access to staking positions') THEN
    CREATE POLICY "Service role full access to staking positions" ON club_staking_positions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staking_positions_user_id ON club_staking_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_staking_positions_status ON club_staking_positions(status);

-- ============================================================
-- PART 5: Drop and recreate RPC functions (return types changed)
-- ============================================================

DROP FUNCTION IF EXISTS get_club_token_balance(UUID);
DROP FUNCTION IF EXISTS add_club_tokens(UUID, INTEGER, TEXT, TEXT, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS deduct_club_tokens(UUID, INTEGER, TEXT, TEXT, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION add_club_tokens(
  p_user_id UUID,
  p_amount NUMERIC,
  p_transaction_type TEXT,
  p_description TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_total NUMERIC;
BEGIN
  INSERT INTO club_token_balances (user_id, total_tokens, lifetime_earned)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    total_tokens = club_token_balances.total_tokens + p_amount,
    lifetime_earned = club_token_balances.lifetime_earned + p_amount,
    last_transaction_at = now(),
    updated_at = now();

  SELECT total_tokens INTO v_new_total
  FROM club_token_balances WHERE user_id = p_user_id;

  INSERT INTO club_token_ledger (user_id, transaction_type, amount, balance_after, reference_id, reference_type, description, created_by)
  VALUES (p_user_id, p_transaction_type, p_amount, v_new_total, p_reference_id, p_reference_type, p_description, p_created_by);

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION deduct_club_tokens(
  p_user_id UUID,
  p_amount NUMERIC,
  p_transaction_type TEXT,
  p_description TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_available NUMERIC;
  v_new_total NUMERIC;
BEGIN
  SELECT (total_tokens - locked_tokens) INTO v_available
  FROM club_token_balances WHERE user_id = p_user_id;

  IF v_available IS NULL OR v_available < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE club_token_balances SET
    total_tokens = total_tokens - p_amount,
    lifetime_spent = lifetime_spent + p_amount,
    last_transaction_at = now(),
    updated_at = now()
  WHERE user_id = p_user_id;

  SELECT total_tokens INTO v_new_total
  FROM club_token_balances WHERE user_id = p_user_id;

  INSERT INTO club_token_ledger (user_id, transaction_type, amount, balance_after, reference_id, reference_type, description, created_by)
  VALUES (p_user_id, p_transaction_type, -p_amount, v_new_total, p_reference_id, p_reference_type, p_description, p_created_by);

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION get_club_token_balance(p_user_id UUID)
RETURNS TABLE (
  total_tokens NUMERIC,
  locked_tokens NUMERIC,
  available_tokens NUMERIC,
  lifetime_earned NUMERIC,
  lifetime_spent NUMERIC,
  staked_tokens NUMERIC,
  reward_tokens_pending NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(b.total_tokens, 0)::NUMERIC,
    COALESCE(b.locked_tokens, 0)::NUMERIC,
    COALESCE(b.total_tokens - b.locked_tokens, 0)::NUMERIC,
    COALESCE(b.lifetime_earned, 0)::NUMERIC,
    COALESCE(b.lifetime_spent, 0)::NUMERIC,
    COALESCE(b.staked_tokens, 0)::NUMERIC,
    COALESCE(b.reward_tokens_pending, 0)::NUMERIC
  FROM club_token_balances b
  WHERE b.user_id = p_user_id;
END;
$$;

-- ============================================================
-- PART 6: New RPC for credit discount lookup
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_credit_discount(p_user_id UUID)
RETURNS TABLE (
  credit_discount INTEGER,
  tier_level INTEGER,
  tier_name TEXT,
  staking_enabled BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(pkg.credit_discount, 0),
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
