/*
  ═══════════════════════════════════════════════════════════════════════════
  PIPNOSIS CLUB - COMPREHENSIVE DATABASE INFRASTRUCTURE
  Migration: 20260208_100000_create_pipnosis_club_infrastructure.sql
  ═══════════════════════════════════════════════════════════════════════════

  PHASE 1 IMPLEMENTATION: Foundation for membership, tokens, chat, and analytics

  This migration creates the complete database foundation for Pipnosis Club,
  a gated membership and utility token ecosystem within Pipnosis.

  CRITICAL DISTINCTIONS:
  - Trading Credits: Fixed-price currency for trade execution (existing system)
  - Club Tokens: Utility tokens for Club access, rewards, governance (new system)
  - These systems are SEPARATE and do NOT convert between each other

  TABLES CREATED:
  1. club_membership_packages - One-time membership tiers for purchase
  2. club_memberships - User membership records with status tracking
  3. club_token_balances - Current Club token balance per user (SSOT)
  4. club_token_ledger - Immutable transaction log for all token movements
  5. club_referrals - Referral codes, tracking, and earnings
  6. club_chat_messages - Real-time chat system with media support
  7. club_chat_reactions - Emoji reactions on messages
  8. club_rewards - Staking/reward tracking (Phase 1: display only, extensible)
  9. club_cashout_requests - Crypto withdrawal request queue
  10. club_analytics_snapshots - Aggregated metrics for admin dashboard

  SECURITY:
  - All tables have RLS enabled
  - Users can only access their own data
  - Admins have elevated permissions for moderation and analytics
  - Service role (Netlify functions) can write to all tables

  EXTENSIBILITY (Phase 2):
  - Placeholder columns for tokenomics (emission rates, staking APY)
  - Designed for future price algorithm integration
  - Governance and voting system hooks
  - Automated payout system integration points

  ═══════════════════════════════════════════════════════════════════════════
*/

-- ============================================================================
-- SECTION 1: MEMBERSHIP PACKAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_membership_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  tier_level integer NOT NULL CHECK (tier_level >= 1 AND tier_level <= 10),
  price_usd numeric(10,2) NOT NULL CHECK (price_usd >= 0),
  initial_token_allocation integer NOT NULL CHECK (initial_token_allocation >= 0),
  required_token_balance integer NOT NULL CHECK (required_token_balance >= 0),
  stripe_price_id text,
  stripe_product_id text,
  benefits jsonb DEFAULT '[]'::jsonb,
  badge_color text DEFAULT '#6366f1',
  badge_icon text DEFAULT 'crown',
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,

  -- Phase 2 extensibility
  governance_weight numeric(5,2) DEFAULT 1.0,
  staking_boost_multiplier numeric(5,2) DEFAULT 1.0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(tier_level),
  UNIQUE(stripe_price_id)
);

COMMENT ON TABLE club_membership_packages IS 'One-time membership packages for Club access with token allocations';
COMMENT ON COLUMN club_membership_packages.tier_level IS 'Numerical tier ranking (1=basic, 10=elite)';
COMMENT ON COLUMN club_membership_packages.initial_token_allocation IS 'Tokens awarded immediately upon purchase';
COMMENT ON COLUMN club_membership_packages.required_token_balance IS 'Minimum tokens needed to maintain Club access';

-- ============================================================================
-- SECTION 2: USER MEMBERSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES club_membership_packages(id) ON DELETE RESTRICT,
  tier_level integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired', 'cancelled')),

  purchased_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at timestamptz, -- NULL = lifetime membership
  last_access_check timestamptz DEFAULT now(),

  -- Payment tracking
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount_paid_usd numeric(10,2) NOT NULL,

  -- Access control
  tokens_locked integer NOT NULL DEFAULT 0,
  can_access_club boolean GENERATED ALWAYS AS (status = 'active') STORED,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id),
  UNIQUE(stripe_session_id)
);

COMMENT ON TABLE club_memberships IS 'User membership records with access control and payment tracking';
COMMENT ON COLUMN club_memberships.tokens_locked IS 'Tokens required to maintain access (copied from package)';
COMMENT ON COLUMN club_memberships.can_access_club IS 'Computed field: active status = access granted';

CREATE INDEX idx_club_memberships_user_id ON club_memberships(user_id);
CREATE INDEX idx_club_memberships_status ON club_memberships(status);
CREATE INDEX idx_club_memberships_tier_level ON club_memberships(tier_level);

-- ============================================================================
-- SECTION 3: TOKEN BALANCE (SSOT)
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_token_balances (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,

  total_tokens integer NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  locked_tokens integer NOT NULL DEFAULT 0 CHECK (locked_tokens >= 0),
  available_tokens integer GENERATED ALWAYS AS (total_tokens - locked_tokens) STORED,

  -- Lifetime stats
  lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent integer NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),

  -- Phase 2 extensibility
  staked_tokens integer DEFAULT 0 CHECK (staked_tokens >= 0),
  reward_tokens_pending integer DEFAULT 0 CHECK (reward_tokens_pending >= 0),

  last_transaction_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE club_token_balances IS 'SSOT for Club token balances - updated only via RPC functions';
COMMENT ON COLUMN club_token_balances.total_tokens IS 'All tokens owned by user (locked + available + staked)';
COMMENT ON COLUMN club_token_balances.locked_tokens IS 'Tokens required for membership access (cannot spend)';
COMMENT ON COLUMN club_token_balances.available_tokens IS 'Spendable tokens (computed: total - locked)';

CREATE INDEX idx_club_token_balances_total ON club_token_balances(total_tokens);

-- ============================================================================
-- SECTION 4: TOKEN LEDGER (IMMUTABLE AUDIT LOG)
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_token_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  transaction_type text NOT NULL CHECK (transaction_type IN (
    'membership_purchase',
    'referral_reward',
    'staking_reward',
    'admin_grant',
    'admin_deduct',
    'cashout_deduction',
    'promotion_bonus',
    'migration_adjustment'
  )),

  amount integer NOT NULL, -- Positive = credit, Negative = debit
  balance_after integer NOT NULL CHECK (balance_after >= 0),

  -- Context tracking
  reference_id uuid, -- membership_id, referral_id, cashout_id, etc.
  reference_type text CHECK (reference_type IN (
    'membership',
    'referral',
    'cashout',
    'staking',
    'admin_action',
    'promotion'
  )),

  description text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,

  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL, -- Admin who performed action
  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_transaction_amount CHECK (amount != 0)
);

COMMENT ON TABLE club_token_ledger IS 'Immutable audit log for all Club token transactions';
COMMENT ON COLUMN club_token_ledger.amount IS 'Positive = tokens added, Negative = tokens deducted';
COMMENT ON COLUMN club_token_ledger.reference_id IS 'Links to source record (membership, referral, etc.)';

CREATE INDEX idx_club_token_ledger_user_id ON club_token_ledger(user_id);
CREATE INDEX idx_club_token_ledger_created_at ON club_token_ledger(created_at DESC);
CREATE INDEX idx_club_token_ledger_type ON club_token_ledger(transaction_type);

-- ============================================================================
-- SECTION 5: REFERRAL SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  referee_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,

  referral_code text NOT NULL UNIQUE,

  -- Tracking
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'fraud')),
  referred_at timestamptz DEFAULT now(),
  completed_at timestamptz, -- When referee purchased membership

  -- Rewards
  tokens_awarded integer DEFAULT 0 CHECK (tokens_awarded >= 0),
  cash_awarded_usd numeric(10,2) DEFAULT 0 CHECK (cash_awarded_usd >= 0),
  reward_paid boolean DEFAULT false,
  reward_paid_at timestamptz,

  -- Anti-fraud
  referee_ip_hash text,
  referee_fingerprint_hash text,
  fraud_score integer DEFAULT 0 CHECK (fraud_score >= 0 AND fraud_score <= 100),
  fraud_reason text,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE club_referrals IS 'Referral tracking with fraud prevention and reward management';
COMMENT ON COLUMN club_referrals.referral_code IS 'Unique code for sharing (e.g., CLUB-ABC123)';
COMMENT ON COLUMN club_referrals.fraud_score IS '0-100 risk score from anti-fraud system';

CREATE INDEX idx_club_referrals_referrer_id ON club_referrals(referrer_id);
CREATE INDEX idx_club_referrals_code ON club_referrals(referral_code);
CREATE INDEX idx_club_referrals_status ON club_referrals(status);

-- Referral stats materialized view
CREATE TABLE IF NOT EXISTS club_referral_stats (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,

  total_referrals integer DEFAULT 0,
  completed_referrals integer DEFAULT 0,
  pending_referrals integer DEFAULT 0,

  total_tokens_earned integer DEFAULT 0,
  total_cash_earned_usd numeric(10,2) DEFAULT 0,

  last_referral_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE club_referral_stats IS 'Aggregated referral statistics for dashboard display';

-- ============================================================================
-- SECTION 6: CHAT SYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file')),
  content text NOT NULL,

  -- Media attachments
  media_url text,
  media_type text, -- image/jpeg, application/pdf, etc.
  media_size_bytes integer,
  thumbnail_url text,

  -- User context at time of message
  membership_tier integer NOT NULL,
  membership_badge jsonb DEFAULT '{}'::jsonb,

  -- Moderation
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  deletion_reason text,

  -- Engagement
  reaction_count integer DEFAULT 0,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE club_chat_messages IS 'Club-only chat messages with media support and moderation';
COMMENT ON COLUMN club_chat_messages.membership_tier IS 'User tier at time of message (for display badges)';

CREATE INDEX idx_club_chat_messages_created_at ON club_chat_messages(created_at DESC);
CREATE INDEX idx_club_chat_messages_user_id ON club_chat_messages(user_id);
CREATE INDEX idx_club_chat_messages_deleted ON club_chat_messages(is_deleted) WHERE is_deleted = false;

-- ============================================================================
-- SECTION 7: CHAT REACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_chat_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES club_chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  emoji text NOT NULL, -- Unicode emoji or emoji shortcode

  created_at timestamptz DEFAULT now(),

  UNIQUE(message_id, user_id, emoji)
);

COMMENT ON TABLE club_chat_reactions IS 'Emoji reactions on chat messages (one per user per emoji)';

CREATE INDEX idx_club_chat_reactions_message_id ON club_chat_reactions(message_id);

-- ============================================================================
-- SECTION 8: REWARDS & STAKING (PHASE 1: DISPLAY ONLY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Display-only values for Phase 1
  staking_balance integer DEFAULT 0 CHECK (staking_balance >= 0),
  total_rewards_earned integer DEFAULT 0 CHECK (total_rewards_earned >= 0),
  pending_rewards integer DEFAULT 0 CHECK (pending_rewards >= 0),

  -- Phase 2 extensibility
  staking_start_date timestamptz,
  current_apy numeric(5,2) DEFAULT 0, -- Placeholder for future APY calculation
  last_reward_claim_at timestamptz,

  -- Conversion tracking
  tokens_converted_to_cash integer DEFAULT 0,
  conversion_rate_snapshot numeric(10,4), -- Token price at time of conversion

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id)
);

COMMENT ON TABLE club_rewards IS 'Phase 1: Display-only staking/rewards. Phase 2: Active calculation logic';
COMMENT ON COLUMN club_rewards.current_apy IS 'Placeholder - will be calculated by future staking engine';

-- ============================================================================
-- SECTION 9: CASHOUT REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_cashout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Request details
  amount_usd numeric(10,2) NOT NULL CHECK (amount_usd >= 100), -- Minimum $100
  tokens_deducted integer NOT NULL CHECK (tokens_deducted > 0),
  conversion_rate numeric(10,4) NOT NULL, -- USD per token at time of request

  -- Payout details
  payout_method text NOT NULL DEFAULT 'ethereum' CHECK (payout_method IN ('ethereum', 'bitcoin', 'bank_transfer')),
  wallet_address text NOT NULL,
  wallet_address_verified boolean DEFAULT false,

  -- Status tracking
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'under_review',
    'approved',
    'processing',
    'completed',
    'rejected',
    'cancelled'
  )),

  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,

  -- Transaction tracking
  blockchain_tx_hash text,
  blockchain_network text, -- mainnet, testnet

  rejection_reason text,
  admin_notes text,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE club_cashout_requests IS 'Crypto withdrawal requests with admin review workflow';
COMMENT ON COLUMN club_cashout_requests.amount_usd IS 'Minimum $100 USD cashout enforced by constraint';
COMMENT ON COLUMN club_cashout_requests.wallet_address IS 'Cryptocurrency wallet address for payout';

CREATE INDEX idx_club_cashout_requests_user_id ON club_cashout_requests(user_id);
CREATE INDEX idx_club_cashout_requests_status ON club_cashout_requests(status);
CREATE INDEX idx_club_cashout_requests_created_at ON club_cashout_requests(created_at DESC);

-- ============================================================================
-- SECTION 10: ANALYTICS SNAPSHOTS (ADMIN DASHBOARD)
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('hourly', 'daily', 'weekly', 'monthly')),
  snapshot_date date NOT NULL,
  snapshot_hour integer CHECK (snapshot_hour >= 0 AND snapshot_hour <= 23),

  -- User metrics
  total_users integer DEFAULT 0,
  active_users integer DEFAULT 0,
  new_users integer DEFAULT 0,

  -- Membership metrics
  total_memberships integer DEFAULT 0,
  memberships_by_tier jsonb DEFAULT '{}'::jsonb,

  -- Token metrics
  total_tokens_circulating integer DEFAULT 0,
  total_tokens_locked integer DEFAULT 0,
  total_tokens_staked integer DEFAULT 0,

  -- Financial metrics (all in USD)
  revenue_memberships numeric(15,2) DEFAULT 0,
  revenue_trading_credits numeric(15,2) DEFAULT 0, -- Cross-reference to main system
  total_cashouts_paid numeric(15,2) DEFAULT 0,

  -- Token price (display/speculative)
  token_price_usd numeric(10,4), -- Internal calculated price

  -- Engagement metrics
  chat_messages_sent integer DEFAULT 0,
  referrals_completed integer DEFAULT 0,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),

  UNIQUE(snapshot_type, snapshot_date, snapshot_hour)
);

COMMENT ON TABLE club_analytics_snapshots IS 'Time-series analytics for admin dashboard and reporting';
COMMENT ON COLUMN club_analytics_snapshots.token_price_usd IS 'Internal speculative price - NOT tradable';

CREATE INDEX idx_club_analytics_snapshots_date ON club_analytics_snapshots(snapshot_date DESC);
CREATE INDEX idx_club_analytics_snapshots_type ON club_analytics_snapshots(snapshot_type);

-- ============================================================================
-- SECTION 11: RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE club_membership_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_token_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_token_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_referral_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_chat_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_cashout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- Membership Packages: Public read, admin write
CREATE POLICY "Anyone can view active membership packages"
  ON club_membership_packages FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage membership packages"
  ON club_membership_packages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Memberships: Users read own, service role writes
CREATE POLICY "Users can view own membership"
  ON club_memberships FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can write memberships"
  ON club_memberships FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Admins can view all memberships"
  ON club_memberships FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Token Balances: Users read own, RPC functions write
CREATE POLICY "Users can view own token balance"
  ON club_token_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage token balances"
  ON club_token_balances FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Token Ledger: Users read own, service role writes
CREATE POLICY "Users can view own token transactions"
  ON club_token_ledger FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can write token transactions"
  ON club_token_ledger FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- Referrals: Users read own, service role writes
CREATE POLICY "Users can view own referrals"
  ON club_referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

CREATE POLICY "Service role can manage referrals"
  ON club_referrals FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Referral Stats: Users read own, service role writes
CREATE POLICY "Users can view own referral stats"
  ON club_referral_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage referral stats"
  ON club_referral_stats FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Chat Messages: Club members read, authenticated users write
CREATE POLICY "Club members can view chat messages"
  ON club_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_memberships
      WHERE club_memberships.user_id = auth.uid()
      AND club_memberships.status = 'active'
    )
    AND is_deleted = false
  );

CREATE POLICY "Authenticated users can send chat messages"
  ON club_chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can edit own messages"
  ON club_chat_messages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can moderate chat"
  ON club_chat_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Chat Reactions: Club members read/write
CREATE POLICY "Club members can view reactions"
  ON club_chat_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_memberships
      WHERE club_memberships.user_id = auth.uid()
      AND club_memberships.status = 'active'
    )
  );

CREATE POLICY "Authenticated users can add reactions"
  ON club_chat_reactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove own reactions"
  ON club_chat_reactions FOR DELETE
  USING (auth.uid() = user_id);

-- Rewards: Users read own, service role writes
CREATE POLICY "Users can view own rewards"
  ON club_rewards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage rewards"
  ON club_rewards FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Cashout Requests: Users manage own, admins review all
CREATE POLICY "Users can view own cashout requests"
  ON club_cashout_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create cashout requests"
  ON club_cashout_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can cancel pending requests"
  ON club_cashout_requests FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status IN ('pending', 'cancelled'));

CREATE POLICY "Admins can manage all cashout requests"
  ON club_cashout_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Analytics: Admin only
CREATE POLICY "Admins can view analytics"
  ON club_analytics_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can write analytics"
  ON club_analytics_snapshots FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- SECTION 12: RPC FUNCTIONS
-- ============================================================================

-- Get user's Club token balance (SSOT)
CREATE OR REPLACE FUNCTION get_club_token_balance(p_user_id uuid)
RETURNS TABLE (
  total_tokens integer,
  locked_tokens integer,
  available_tokens integer,
  lifetime_earned integer,
  lifetime_spent integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ctb.total_tokens,
    ctb.locked_tokens,
    ctb.available_tokens,
    ctb.lifetime_earned,
    ctb.lifetime_spent
  FROM club_token_balances ctb
  WHERE ctb.user_id = p_user_id;

  -- If no balance record exists, return zeros
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::integer, 0::integer, 0::integer, 0::integer, 0::integer;
  END IF;
END;
$$;

-- Add Club tokens (membership purchase, rewards, admin grant)
CREATE OR REPLACE FUNCTION add_club_tokens(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_description text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Insert or update balance
  INSERT INTO club_token_balances (user_id, total_tokens, lifetime_earned, last_transaction_at)
  VALUES (p_user_id, p_amount, p_amount, now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    total_tokens = club_token_balances.total_tokens + p_amount,
    lifetime_earned = club_token_balances.lifetime_earned + p_amount,
    last_transaction_at = now(),
    updated_at = now()
  RETURNING total_tokens INTO v_new_balance;

  -- Log transaction
  INSERT INTO club_token_ledger (
    user_id,
    transaction_type,
    amount,
    balance_after,
    reference_id,
    reference_type,
    description,
    created_by
  ) VALUES (
    p_user_id,
    p_transaction_type,
    p_amount,
    v_new_balance,
    p_reference_id,
    p_reference_type,
    p_description,
    p_created_by
  );

  RETURN true;
END;
$$;

-- Deduct Club tokens (cashout, admin action)
CREATE OR REPLACE FUNCTION deduct_club_tokens(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_description text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance integer;
  v_available_tokens integer;
  v_new_balance integer;
BEGIN
  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Get current available balance
  SELECT total_tokens, available_tokens INTO v_current_balance, v_available_tokens
  FROM club_token_balances
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User has no token balance record';
  END IF;

  -- Check sufficient available tokens (cannot spend locked tokens)
  IF v_available_tokens < p_amount THEN
    RAISE EXCEPTION 'Insufficient available tokens (have: %, need: %)', v_available_tokens, p_amount;
  END IF;

  -- Deduct tokens
  UPDATE club_token_balances
  SET
    total_tokens = total_tokens - p_amount,
    lifetime_spent = lifetime_spent + p_amount,
    last_transaction_at = now(),
    updated_at = now()
  WHERE user_id = p_user_id
  RETURNING total_tokens INTO v_new_balance;

  -- Log transaction (negative amount)
  INSERT INTO club_token_ledger (
    user_id,
    transaction_type,
    amount,
    balance_after,
    reference_id,
    reference_type,
    description,
    created_by
  ) VALUES (
    p_user_id,
    p_transaction_type,
    -p_amount,
    v_new_balance,
    p_reference_id,
    p_reference_type,
    p_description,
    p_created_by
  );

  RETURN true;
END;
$$;

-- Check if user can access Club
CREATE OR REPLACE FUNCTION can_user_access_club(p_user_id uuid)
RETURNS TABLE (
  has_membership boolean,
  membership_active boolean,
  has_sufficient_tokens boolean,
  can_access boolean,
  tokens_required integer,
  tokens_available integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_membership_record club_memberships%ROWTYPE;
  v_token_balance club_token_balances%ROWTYPE;
BEGIN
  -- Get membership
  SELECT * INTO v_membership_record
  FROM club_memberships
  WHERE user_id = p_user_id;

  -- Get token balance
  SELECT * INTO v_token_balance
  FROM club_token_balances
  WHERE user_id = p_user_id;

  RETURN QUERY
  SELECT
    v_membership_record.id IS NOT NULL AS has_membership,
    v_membership_record.status = 'active' AS membership_active,
    COALESCE(v_token_balance.available_tokens, 0) >= COALESCE(v_membership_record.tokens_locked, 0) AS has_sufficient_tokens,
    (v_membership_record.status = 'active' AND
     COALESCE(v_token_balance.available_tokens, 0) >= COALESCE(v_membership_record.tokens_locked, 0)) AS can_access,
    COALESCE(v_membership_record.tokens_locked, 0) AS tokens_required,
    COALESCE(v_token_balance.available_tokens, 0) AS tokens_available;
END;
$$;

-- ============================================================================
-- SECTION 13: TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_club_membership_packages_updated_at
  BEFORE UPDATE ON club_membership_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_club_memberships_updated_at
  BEFORE UPDATE ON club_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_club_token_balances_updated_at
  BEFORE UPDATE ON club_token_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_club_referrals_updated_at
  BEFORE UPDATE ON club_referrals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_club_chat_messages_updated_at
  BEFORE UPDATE ON club_chat_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_club_rewards_updated_at
  BEFORE UPDATE ON club_rewards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_club_cashout_requests_updated_at
  BEFORE UPDATE ON club_cashout_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SECTION 14: SEED DATA (SAMPLE MEMBERSHIP PACKAGES)
-- ============================================================================

INSERT INTO club_membership_packages (name, description, tier_level, price_usd, initial_token_allocation, required_token_balance, benefits, badge_color, badge_icon, display_order)
VALUES
  (
    'Bronze Member',
    'Entry-level access to Pipnosis Club with community features',
    1,
    49.99,
    500,
    100,
    '["Access to Club chat", "Referral rewards", "Monthly newsletter", "Basic support"]'::jsonb,
    '#cd7f32',
    'award',
    1
  ),
  (
    'Silver Member',
    'Enhanced membership with increased token allocation and benefits',
    2,
    99.99,
    1200,
    200,
    '["All Bronze benefits", "Priority support", "Exclusive webinars", "Early feature access"]'::jsonb,
    '#c0c0c0',
    'medal',
    2
  ),
  (
    'Gold Member',
    'Premium membership with maximum benefits and highest token rewards',
    3,
    199.99,
    3000,
    400,
    '["All Silver benefits", "VIP support", "Private strategy sessions", "Governance voting rights", "Highest staking rewards"]'::jsonb,
    '#ffd700',
    'crown',
    3
  )
ON CONFLICT (tier_level) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify tables created
DO $$
DECLARE
  table_count integer;
BEGIN
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name LIKE 'club_%';

  RAISE NOTICE 'Created % Club tables', table_count;
END $$;
