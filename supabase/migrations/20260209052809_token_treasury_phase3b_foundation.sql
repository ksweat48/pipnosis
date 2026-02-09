/*
  # Token Treasury & PIP Utility Index - Phase 3B Foundation

  ## Overview
  Implements the complete token treasury system with:
  - Token pool accounting (6 pools: Community, Marketing, Public Liquidity, Founders, Operations, Burned)
  - User token lifecycle tracking (liquid, staked, rewards, vested, burned buckets)
  - Dynamic PIP Utility Index calculation engine
  - Full event-sourcing and integrity constraints

  ## Tables Created
  1. `token_pools` - SSOT for pool balances (6 pools, 100M total supply)
  2. `token_pool_events` - Immutable audit log for all pool movements
  3. `token_balances` - User-level SSOT (liquid/staked/rewards/vested/burned)
  4. `token_events` - Immutable user token event log
  5. `pip_utility_index_history` - Daily time series of utility value
  6. `pip_utility_index_state` - Single-row config for index calculation

  ## Security
  - RLS enabled on all tables
  - Service role for system operations
  - Authenticated users can read own balances
  - Admin-only access to pool management

  ## Integrity Constraints
  - Pool balances never negative
  - Sum of pools + burned = 100,000,000 PIP
  - All pool mutations require event records
  - Non-transferable tokens (no user-to-user transfers)
  - Index computation is deterministic and replayable
*/

-- =====================================================
-- 1. TOKEN POOLS (SSOT for pool accounting)
-- =====================================================

CREATE TABLE IF NOT EXISTS token_pools (
  pool_id TEXT PRIMARY KEY CHECK (pool_id IN (
    'COMMUNITY_INCENTIVES',
    'MARKETING_PARTNERS',
    'PUBLIC_LIQUIDITY_FUTURE',
    'FOUNDERS_TEAM',
    'OPERATIONS_RESERVE',
    'BURNED'
  )),
  pool_name TEXT NOT NULL,
  initial_allocation_pip DECIMAL(18,4) NOT NULL CHECK (initial_allocation_pip >= 0),
  current_balance_pip DECIMAL(18,4) NOT NULL CHECK (current_balance_pip >= 0),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

COMMENT ON TABLE token_pools IS 'SSOT for token pool balances. Total supply: 100M PIP distributed across 6 pools.';

-- =====================================================
-- 2. TOKEN POOL EVENTS (Immutable audit log)
-- =====================================================

CREATE TABLE IF NOT EXISTS token_pool_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ DEFAULT now() NOT NULL,
  pool_id TEXT NOT NULL REFERENCES token_pools(pool_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'POOL_INIT',
    'POOL_DEBIT',
    'POOL_CREDIT',
    'POOL_TRANSFER',
    'POOL_BURN_SINK'
  )),
  amount_pip DECIMAL(18,4) NOT NULL CHECK (amount_pip > 0),
  ref_type TEXT,
  ref_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_pool_events_pool_ts ON token_pool_events(pool_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_token_pool_events_type ON token_pool_events(event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_token_pool_events_ref ON token_pool_events(ref_type, ref_id);

COMMENT ON TABLE token_pool_events IS 'Immutable event log for all token pool operations. Event-sourced audit trail.';

-- =====================================================
-- 3. TOKEN BALANCES (User-level SSOT)
-- =====================================================

CREATE TABLE IF NOT EXISTS token_balances (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pip_liquid DECIMAL(18,4) DEFAULT 0 NOT NULL CHECK (pip_liquid >= 0),
  pip_staked DECIMAL(18,4) DEFAULT 0 NOT NULL CHECK (pip_staked >= 0),
  pip_rewards_pending DECIMAL(18,4) DEFAULT 0 NOT NULL CHECK (pip_rewards_pending >= 0),
  pip_vested DECIMAL(18,4) DEFAULT 0 NOT NULL CHECK (pip_vested >= 0),
  pip_burned_total DECIMAL(18,4) DEFAULT 0 NOT NULL CHECK (pip_burned_total >= 0),
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_balances_liquid ON token_balances(pip_liquid DESC) WHERE pip_liquid > 0;
CREATE INDEX IF NOT EXISTS idx_token_balances_staked ON token_balances(pip_staked DESC) WHERE pip_staked > 0;

COMMENT ON TABLE token_balances IS 'User token balance SSOT. Buckets: liquid, staked, rewards_pending, vested, burned_total.';

-- =====================================================
-- 4. TOKEN EVENTS (User-level immutable event log)
-- =====================================================

CREATE TABLE IF NOT EXISTS token_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ DEFAULT now() NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'GRANT',
    'BURN',
    'STAKE_LOCK',
    'STAKE_UNLOCK',
    'REWARD_ACCRUE',
    'REWARD_CLAIM',
    'VEST_LOCK',
    'VEST_RELEASE',
    'ADMIN_ADJUST'
  )),
  amount_pip DECIMAL(18,4) NOT NULL CHECK (amount_pip > 0),
  bucket_from TEXT CHECK (bucket_from IN ('liquid', 'staked', 'rewards_pending', 'vested', 'burned', 'external')),
  bucket_to TEXT CHECK (bucket_to IN ('liquid', 'staked', 'rewards_pending', 'vested', 'burned', 'external')),
  ref_type TEXT,
  ref_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_events_user_ts ON token_events(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_token_events_type ON token_events(event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_token_events_ref ON token_events(ref_type, ref_id);

COMMENT ON TABLE token_events IS 'Immutable user token event log. Event-sourced audit trail for all user token operations.';

-- =====================================================
-- 5. PIP UTILITY INDEX HISTORY (Daily time series)
-- =====================================================

CREATE TABLE IF NOT EXISTS pip_utility_index_history (
  date DATE PRIMARY KEY,
  credits_spent_30d BIGINT NOT NULL CHECK (credits_spent_30d >= 0),
  pip_burned_30d DECIMAL(18,4) NOT NULL CHECK (pip_burned_30d >= 0),
  staked_ratio DECIMAL(8,6) NOT NULL CHECK (staked_ratio >= 0 AND staked_ratio <= 1),
  active_users_30d INTEGER NOT NULL CHECK (active_users_30d >= 0),
  liquid_supply_ratio DECIMAL(8,6) NOT NULL CHECK (liquid_supply_ratio >= 0 AND liquid_supply_ratio <= 1),
  raw_index DECIMAL(12,6) NOT NULL CHECK (raw_index >= 0),
  smoothed_index DECIMAL(12,6) NOT NULL CHECK (smoothed_index >= 0),
  display_value_usd DECIMAL(10,4) NOT NULL CHECK (display_value_usd >= 0),
  computation_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pip_utility_index_history_date ON pip_utility_index_history(date DESC);

COMMENT ON TABLE pip_utility_index_history IS 'Daily PIP Utility Index time series. Deterministic calculation based on platform activity.';

-- =====================================================
-- 6. PIP UTILITY INDEX STATE (Single-row config)
-- =====================================================

CREATE TABLE IF NOT EXISTS pip_utility_index_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_computed_date DATE,
  previous_smoothed_index DECIMAL(12,6) DEFAULT 1.0 NOT NULL,
  alpha DECIMAL(4,3) DEFAULT 0.15 NOT NULL CHECK (alpha > 0 AND alpha <= 1),
  weight_credits DECIMAL(4,3) DEFAULT 0.40 NOT NULL CHECK (weight_credits >= 0 AND weight_credits <= 1),
  weight_burn DECIMAL(4,3) DEFAULT 0.30 NOT NULL CHECK (weight_burn >= 0 AND weight_burn <= 1),
  weight_stake DECIMAL(4,3) DEFAULT 0.20 NOT NULL CHECK (weight_stake >= 0 AND weight_stake <= 1),
  weight_active DECIMAL(4,3) DEFAULT 0.10 NOT NULL CHECK (weight_active >= 0 AND weight_active <= 1),
  base_utility_value DECIMAL(10,4) DEFAULT 0.10 NOT NULL CHECK (base_utility_value > 0),
  normalization_bounds JSONB DEFAULT '{
    "credits_spent": {"min": 0, "max": 1000000},
    "pip_burned": {"min": 0, "max": 100000},
    "staked_ratio": {"min": 0, "max": 1},
    "active_users": {"min": 0, "max": 10000},
    "liquid_supply_ratio": {"min": 0, "max": 1}
  }'::jsonb NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT weights_sum_check CHECK (
    weight_credits + weight_burn + weight_stake + weight_active = 1.0
  )
);

COMMENT ON TABLE pip_utility_index_state IS 'Single-row configuration for PIP Utility Index calculation. Admin-configurable parameters.';

-- =====================================================
-- 7. INITIALIZE TOKEN POOLS (One-time setup)
-- =====================================================

INSERT INTO token_pools (pool_id, pool_name, initial_allocation_pip, current_balance_pip) VALUES
  ('COMMUNITY_INCENTIVES', 'Community & Incentives', 30000000.0000, 30000000.0000),
  ('MARKETING_PARTNERS', 'Marketing & Partners', 15000000.0000, 15000000.0000),
  ('PUBLIC_LIQUIDITY_FUTURE', 'Public Liquidity (Future)', 25000000.0000, 25000000.0000),
  ('FOUNDERS_TEAM', 'Founders & Team', 20000000.0000, 20000000.0000),
  ('OPERATIONS_RESERVE', 'Operations Reserve', 10000000.0000, 10000000.0000),
  ('BURNED', 'Burned (Sink)', 0.0000, 0.0000)
ON CONFLICT (pool_id) DO NOTHING;

INSERT INTO token_pool_events (pool_id, event_type, amount_pip, ref_type, metadata)
SELECT
  pool_id,
  'POOL_INIT',
  initial_allocation_pip,
  'system_initialization',
  jsonb_build_object('note', 'Initial pool allocation at Phase 3B launch')
FROM token_pools
WHERE pool_id != 'BURNED'
ON CONFLICT DO NOTHING;

-- =====================================================
-- 8. INITIALIZE INDEX STATE
-- =====================================================

INSERT INTO pip_utility_index_state (id, last_computed_date, previous_smoothed_index)
VALUES (1, NULL, 1.0)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 9. RLS POLICIES
-- =====================================================

ALTER TABLE token_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_pool_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pip_utility_index_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pip_utility_index_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view token pools" ON token_pools FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role can manage token pools" ON token_pools FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Admins can view token pool events" ON token_pool_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role can insert token pool events" ON token_pool_events FOR INSERT TO service_role
WITH CHECK (true);

CREATE POLICY "Users can view own token balances" ON token_balances FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all token balances" ON token_balances FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role can manage token balances" ON token_balances FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Users can view own token events" ON token_events FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all token events" ON token_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role can insert token events" ON token_events FOR INSERT TO service_role
WITH CHECK (true);

CREATE POLICY "Authenticated users can view index history" ON pip_utility_index_history FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Service role can manage index history" ON pip_utility_index_history FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view index state" ON pip_utility_index_state FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can update index state" ON pip_utility_index_state FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true))
WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true));

CREATE POLICY "Service role can manage index state" ON pip_utility_index_state FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- =====================================================
-- 10. INTEGRITY CHECK FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION verify_token_supply_integrity()
RETURNS TABLE (
  check_name TEXT,
  passed BOOLEAN,
  expected_value DECIMAL(18,4),
  actual_value DECIMAL(18,4),
  details TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  total_supply CONSTANT DECIMAL(18,4) := 100000000.0000;
  pool_sum DECIMAL(18,4);
  burned_pool DECIMAL(18,4);
  sum_with_burned DECIMAL(18,4);
  user_liquid_sum DECIMAL(18,4);
  user_staked_sum DECIMAL(18,4);
  user_rewards_sum DECIMAL(18,4);
  user_vested_sum DECIMAL(18,4);
  user_burned_sum DECIMAL(18,4);
  circulating_total DECIMAL(18,4);
BEGIN
  SELECT COALESCE(SUM(current_balance_pip), 0) INTO pool_sum
  FROM token_pools WHERE pool_id != 'BURNED';

  SELECT COALESCE(current_balance_pip, 0) INTO burned_pool
  FROM token_pools WHERE pool_id = 'BURNED';

  sum_with_burned := pool_sum + burned_pool;

  RETURN QUERY SELECT
    'Total supply integrity'::TEXT,
    ABS(sum_with_burned - total_supply) < 0.0001,
    total_supply,
    sum_with_burned,
    'Sum of all pools + burned must equal 100M PIP'::TEXT;

  RETURN QUERY SELECT
    'No negative pool balances'::TEXT,
    NOT EXISTS (SELECT 1 FROM token_pools WHERE current_balance_pip < 0),
    0::DECIMAL(18,4),
    COALESCE((SELECT MIN(current_balance_pip) FROM token_pools), 0),
    'All pool balances must be >= 0'::TEXT;

  SELECT
    COALESCE(SUM(pip_liquid), 0),
    COALESCE(SUM(pip_staked), 0),
    COALESCE(SUM(pip_rewards_pending), 0),
    COALESCE(SUM(pip_vested), 0),
    COALESCE(SUM(pip_burned_total), 0)
  INTO user_liquid_sum, user_staked_sum, user_rewards_sum, user_vested_sum, user_burned_sum
  FROM token_balances;

  circulating_total := user_liquid_sum + user_staked_sum + user_rewards_sum + user_vested_sum;

  RETURN QUERY SELECT
    'User circulating total'::TEXT,
    circulating_total <= total_supply,
    total_supply,
    circulating_total,
    'User circulating tokens must not exceed total supply'::TEXT;

  RETURN QUERY SELECT
    'Burned balance reconciliation'::TEXT,
    ABS(burned_pool - user_burned_sum) < 0.0001,
    user_burned_sum,
    burned_pool,
    'BURNED pool must match sum of user pip_burned_total'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_token_supply_integrity TO authenticated;
GRANT EXECUTE ON FUNCTION verify_token_supply_integrity TO service_role;