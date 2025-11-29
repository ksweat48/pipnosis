/*
  # Pipnosis Token Economy System

  ## Overview
  Complete token-based monetization system with:
  - Token balance tracking per user
  - One-time and subscription token packages
  - Signup bonus (5 tokens)
  - Referral system with risk scoring
  - Anti-fraud device fingerprinting
  - Transaction history and audit logs

  ## New Tables
  1. `user_token_balance` - Current token balance per user
  2. `token_transaction_history` - Complete audit log of all token movements
  3. `token_packages` - Pricing tiers (one-time + subscription)
  4. `user_subscriptions` - Active subscription tracking
  5. `referral_codes` - User referral tracking with monthly limits
  6. `referral_tracking` - Referral logs with risk scores
  7. `device_fingerprints` - Anti-fraud device tracking

  ## Security
  - RLS enabled on all tables
  - Users can only view their own token data
  - Admins have unlimited tokens (bypass deduction)
  - Service role for backend operations
*/

-- =====================================================
-- 1. USER TOKEN BALANCE
-- =====================================================

CREATE TABLE IF NOT EXISTS user_token_balance (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  balance decimal(15,2) NOT NULL DEFAULT 5.00 CHECK (balance >= 0),
  lifetime_earned decimal(15,2) NOT NULL DEFAULT 5.00,
  lifetime_spent decimal(15,2) NOT NULL DEFAULT 0.00,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_token_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own token balance"
  ON user_token_balance FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all token balances"
  ON user_token_balance FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage token balances"
  ON user_token_balance FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_token_balance_user_id ON user_token_balance(user_id);

-- =====================================================
-- 2. TOKEN TRANSACTION HISTORY
-- =====================================================

CREATE TABLE IF NOT EXISTS token_transaction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'signup_bonus',
    'referral_reward',
    'referral_earned',
    'purchase_onetime',
    'purchase_subscription',
    'subscription_renewal',
    'admin_adjustment',
    'trade_evaluation',
    'trade_check',
    'position_analysis'
  )),
  amount decimal(15,2) NOT NULL,
  balance_before decimal(15,2) NOT NULL,
  balance_after decimal(15,2) NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE token_transaction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transaction history"
  ON token_transaction_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all transaction history"
  ON token_transaction_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can insert transactions"
  ON token_transaction_history FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_token_transactions_user_id ON token_transaction_history(user_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_type ON token_transaction_history(transaction_type);
CREATE INDEX IF NOT EXISTS idx_token_transactions_created_at ON token_transaction_history(created_at DESC);

-- =====================================================
-- 3. TOKEN PACKAGES (Pricing)
-- =====================================================

CREATE TABLE IF NOT EXISTS token_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type text NOT NULL CHECK (package_type IN ('onetime', 'subscription')),
  name text NOT NULL,
  description text,
  price_usd decimal(10,2) NOT NULL,
  token_amount integer NOT NULL,
  cost_per_token decimal(10,4) NOT NULL,
  stripe_price_id text,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE token_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active token packages"
  ON token_packages FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage token packages"
  ON token_packages FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_token_packages_type ON token_packages(package_type);
CREATE INDEX IF NOT EXISTS idx_token_packages_active ON token_packages(is_active) WHERE is_active = true;

-- =====================================================
-- 4. USER SUBSCRIPTIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES token_packages(id),
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'past_due')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  tokens_granted_this_period boolean DEFAULT false,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all subscriptions"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage subscriptions"
  ON user_subscriptions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_id ON user_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);

-- =====================================================
-- 5. REFERRAL CODES
-- =====================================================

CREATE TABLE IF NOT EXISTS referral_codes (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  referral_code text UNIQUE NOT NULL,
  total_referrals integer DEFAULT 0,
  total_rewards_earned decimal(15,2) DEFAULT 0.00,
  monthly_referrals integer DEFAULT 0,
  last_monthly_reset timestamptz DEFAULT date_trunc('month', now()),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referral code"
  ON referral_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all referral codes"
  ON referral_codes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage referral codes"
  ON referral_codes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(referral_code);

-- =====================================================
-- 6. REFERRAL TRACKING (with Risk Scoring)
-- =====================================================

CREATE TABLE IF NOT EXISTS referral_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  referral_code_used text NOT NULL,
  risk_score integer DEFAULT 0,
  risk_factors jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'requires_verification', 'blocked')),
  reward_granted boolean DEFAULT false,
  referrer_reward_amount decimal(15,2) DEFAULT 5.00,
  referred_reward_amount decimal(15,2) DEFAULT 5.00,
  created_at timestamptz DEFAULT now(),
  verified_at timestamptz,
  UNIQUE(referrer_id, referred_user_id)
);

ALTER TABLE referral_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referrals"
  ON referral_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

CREATE POLICY "Admins can view all referrals"
  ON referral_tracking FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage referrals"
  ON referral_tracking FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_referral_tracking_referrer ON referral_tracking(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_tracking_referred ON referral_tracking(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_tracking_status ON referral_tracking(status);

-- =====================================================
-- 7. DEVICE FINGERPRINTS (Anti-Fraud)
-- =====================================================

CREATE TABLE IF NOT EXISTS device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  ip_address text,
  device_fingerprint text,
  browser_fingerprint text,
  user_agent text,
  screen_resolution text,
  timezone text,
  language text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE device_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage device fingerprints"
  ON device_fingerprints FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_device_fingerprints_user_id ON device_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_ip ON device_fingerprints(ip_address);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_device ON device_fingerprints(device_fingerprint);

-- =====================================================
-- SEED TOKEN PACKAGES
-- =====================================================

INSERT INTO token_packages (package_type, name, description, price_usd, token_amount, cost_per_token, display_order) VALUES
  ('onetime', '100 Tokens', 'One-time purchase', 15.00, 100, 0.15, 1),
  ('onetime', '200 Tokens', 'One-time purchase', 30.00, 200, 0.15, 2),
  ('onetime', '400 Tokens', 'One-time purchase', 60.00, 400, 0.15, 3),
  ('subscription', '100 Tokens Monthly', 'Billed monthly', 10.00, 100, 0.10, 4),
  ('subscription', '200 Tokens Monthly', 'Billed monthly', 20.00, 200, 0.10, 5),
  ('subscription', '500 Tokens Monthly', 'Billed monthly', 50.00, 500, 0.10, 6)
ON CONFLICT DO NOTHING;

-- =====================================================
-- FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION grant_signup_bonus()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_token_balance (user_id, balance, lifetime_earned, lifetime_spent)
  VALUES (NEW.id, 5.00, 5.00, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO token_transaction_history (user_id, transaction_type, amount, balance_before, balance_after, metadata)
  VALUES (NEW.id, 'signup_bonus', 5.00, 0.00, 5.00, jsonb_build_object('reason', 'Welcome bonus'));

  INSERT INTO referral_codes (user_id, referral_code)
  VALUES (NEW.id, 'PIP-' || upper(substring(md5(random()::text || NEW.id::text) from 1 for 4)))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_grant_signup_bonus ON user_profiles;
CREATE TRIGGER trigger_grant_signup_bonus
  AFTER INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION grant_signup_bonus();

CREATE OR REPLACE FUNCTION deduct_tokens(
  p_user_id uuid,
  p_amount decimal,
  p_transaction_type text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS boolean AS $$
DECLARE
  v_is_admin boolean;
  v_current_balance decimal;
  v_new_balance decimal;
BEGIN
  SELECT is_admin INTO v_is_admin FROM user_profiles WHERE id = p_user_id;

  IF v_is_admin THEN
    INSERT INTO token_transaction_history (user_id, transaction_type, amount, balance_before, balance_after, metadata)
    VALUES (p_user_id, p_transaction_type, 0, 999999, 999999, jsonb_build_object('admin_bypass', true) || p_metadata);
    RETURN true;
  END IF;

  SELECT balance INTO v_current_balance FROM user_token_balance WHERE user_id = p_user_id FOR UPDATE;

  IF v_current_balance < p_amount THEN
    RETURN false;
  END IF;

  v_new_balance := v_current_balance - p_amount;

  UPDATE user_token_balance
  SET balance = v_new_balance, lifetime_spent = lifetime_spent + p_amount, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_transaction_history (user_id, transaction_type, amount, balance_before, balance_after, metadata)
  VALUES (p_user_id, p_transaction_type, -p_amount, v_current_balance, v_new_balance, p_metadata);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_tokens(
  p_user_id uuid,
  p_amount decimal,
  p_transaction_type text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS boolean AS $$
DECLARE
  v_current_balance decimal;
  v_new_balance decimal;
BEGIN
  SELECT balance INTO v_current_balance FROM user_token_balance WHERE user_id = p_user_id FOR UPDATE;
  v_new_balance := v_current_balance + p_amount;

  UPDATE user_token_balance
  SET balance = v_new_balance, lifetime_earned = lifetime_earned + p_amount, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO token_transaction_history (user_id, transaction_type, amount, balance_before, balance_after, metadata)
  VALUES (p_user_id, p_transaction_type, p_amount, v_current_balance, v_new_balance, p_metadata);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_token_balance(p_user_id uuid)
RETURNS TABLE (balance decimal, lifetime_earned decimal, lifetime_spent decimal, is_admin boolean) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(utb.balance, 0) as balance,
    COALESCE(utb.lifetime_earned, 0) as lifetime_earned,
    COALESCE(utb.lifetime_spent, 0) as lifetime_spent,
    COALESCE(up.is_admin, false) as is_admin
  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id
  WHERE up.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION deduct_tokens TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION add_tokens TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_token_balance TO authenticated, service_role;
