/*
  # Phase 3A Staking Engine - Comprehensive Implementation
  
  ## Summary
  Implements the Phase 3A Staking Engine with:
  - Event-sourced staking architecture
  - Roll-forward emission model with carryover
  - Unstake request → cooldown → execute workflow
  - Rewards pending bucket (separate from liquid)
  - Tier multipliers (Builder 1.0x, Pro 1.1x, Elite 1.2x, Founder 1.3x)
  
  ## New Tables
  1. `staking_events` (IMMUTABLE) - Event log for all staking operations
  2. `staking_reward_state` (DERIVED) - Per-user reward tracking
  3. `staking_emission_state` (SINGLETON) - Monthly emission state with carryover
  
  ## Modified Tables
  1. `club_staking_positions` - Add UNSTAKE_REQUESTED status, unstake_requested_at
  2. `club_token_balances` - Already has reward_tokens_pending column
  
  ## New RPC Functions
  1. `stake_tokens` - Stake liquid tokens (Builder+ only)
  2. `request_unstake` - Request unstake (7+ days after stake)
  3. `execute_unstake` - Execute after 24h cooldown
  4. `claim_staking_rewards` - Claim rewards without unstaking
  5. `distribute_staking_emissions_v2` - Roll-forward emission distribution
  
  ## Security
  - All tables have RLS enabled
  - Users can only interact with own positions
  - Service role has full access for automation
  - Admin can audit everything
*/

-- ============================================================
-- PART 1: Update club_staking_positions table
-- ============================================================

-- Add UNSTAKE_REQUESTED to status check
ALTER TABLE club_staking_positions DROP CONSTRAINT IF EXISTS valid_staking_status;
ALTER TABLE club_staking_positions ADD CONSTRAINT valid_staking_status 
  CHECK (status IN ('active', 'unstake_requested', 'unlocked', 'cancelled'));

-- Add unstake_requested_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'club_staking_positions' AND column_name = 'unstake_requested_at'
  ) THEN
    ALTER TABLE club_staking_positions ADD COLUMN unstake_requested_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add index for unstake workflow queries
CREATE INDEX IF NOT EXISTS idx_staking_positions_unstake_requested 
  ON club_staking_positions(user_id, status, unstake_requested_at)
  WHERE status = 'unstake_requested';

-- ============================================================
-- PART 2: Create staking_events (IMMUTABLE EVENT LOG)
-- ============================================================

CREATE TABLE IF NOT EXISTS staking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'STAKE', 'UNSTAKE_REQUEST', 'UNSTAKE_EXECUTE', 'REWARD_ACCRUE', 'REWARD_CLAIM', 'POSITION_CANCEL'
  )),
  amount_pip NUMERIC(18,4) NOT NULL DEFAULT 0,
  position_id UUID REFERENCES club_staking_positions(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- This is an immutable log - no updates or deletes allowed
ALTER TABLE staking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own staking events"
  ON staking_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert staking events"
  ON staking_events FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Admins can view all staking events"
  ON staking_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_staking_events_user_id ON staking_events(user_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_staking_events_position_id ON staking_events(position_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_staking_events_type ON staking_events(event_type, event_ts DESC);

-- ============================================================
-- PART 3: Create staking_reward_state (DERIVED STATE)
-- ============================================================

CREATE TABLE IF NOT EXISTS staking_reward_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  staked_pip NUMERIC(18,4) NOT NULL DEFAULT 0,
  pending_rewards_pip NUMERIC(18,4) NOT NULL DEFAULT 0,
  claimed_rewards_total_pip NUMERIC(18,4) NOT NULL DEFAULT 0,
  last_accrual_ts TIMESTAMPTZ,
  last_claim_ts TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT no_negative_staked CHECK (staked_pip >= 0),
  CONSTRAINT no_negative_pending CHECK (pending_rewards_pip >= 0),
  CONSTRAINT no_negative_claimed CHECK (claimed_rewards_total_pip >= 0)
);

ALTER TABLE staking_reward_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reward state"
  ON staking_reward_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage reward state"
  ON staking_reward_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view all reward states"
  ON staking_reward_state FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

-- ============================================================
-- PART 4: Create staking_emission_state (SINGLETON)
-- ============================================================

CREATE TABLE IF NOT EXISTS staking_emission_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_month TEXT NOT NULL,
  monthly_emission_budget_pip NUMERIC(18,4) NOT NULL DEFAULT 100000,
  daily_emission_base_pip NUMERIC(18,4) NOT NULL DEFAULT 3333.33,
  carryover_pip NUMERIC(18,4) NOT NULL DEFAULT 0,
  last_accrual_date DATE,
  total_distributed_lifetime NUMERIC(18,4) NOT NULL DEFAULT 0,
  pool_remaining_pip NUMERIC(18,4) NOT NULL DEFAULT 30000000,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initialize with default values
INSERT INTO staking_emission_state (
  id, current_month, monthly_emission_budget_pip, daily_emission_base_pip, 
  carryover_pip, pool_remaining_pip
)
VALUES (
  1, 
  TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
  100000,
  ROUND(100000.0 / 30.0, 2),
  0,
  30000000
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE staking_emission_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view emission state"
  ON staking_emission_state FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage emission state"
  ON staking_emission_state FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- PART 5: Create stake_tokens RPC
-- ============================================================

CREATE OR REPLACE FUNCTION stake_tokens(
  p_amount NUMERIC,
  p_duration_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_position_id UUID;
  v_tier_level INTEGER;
  v_tier_multiplier NUMERIC(4,2);
  v_available_tokens NUMERIC;
  v_staking_enabled BOOLEAN;
BEGIN
  -- 1. Check eligibility (Builder+ only)
  SELECT 
    m.tier_level,
    pkg.staking_enabled,
    CASE m.tier_level
      WHEN 3 THEN 1.0  -- Builder
      WHEN 4 THEN 1.1  -- Pro
      WHEN 5 THEN 1.2  -- Elite
      WHEN 6 THEN 1.3  -- Founder
      ELSE 0
    END AS multiplier
  INTO v_tier_level, v_staking_enabled, v_tier_multiplier
  FROM club_memberships m
  JOIN club_membership_packages pkg ON pkg.id = m.package_id
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
    AND pkg.is_active = true
  LIMIT 1;

  IF NOT FOUND OR v_tier_level < 3 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staking requires Builder tier or higher'
    );
  END IF;

  IF NOT v_staking_enabled THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staking not enabled for your tier'
    );
  END IF;

  -- 2. Check available balance
  SELECT (total_tokens - locked_tokens - staked_tokens)
  INTO v_available_tokens
  FROM club_token_balances
  WHERE user_id = v_user_id;

  IF v_available_tokens IS NULL OR v_available_tokens < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient available tokens',
      'available', COALESCE(v_available_tokens, 0)
    );
  END IF;

  -- 3. Create staking position
  INSERT INTO club_staking_positions (
    user_id, amount_staked, staked_at, unlock_at, 
    duration_days, status, tier_weight
  )
  VALUES (
    v_user_id, p_amount, now(), 
    now() + (p_duration_days || ' days')::INTERVAL,
    p_duration_days, 'active', v_tier_multiplier
  )
  RETURNING id INTO v_position_id;

  -- 4. Update token balances (move liquid → staked)
  UPDATE club_token_balances
  SET staked_tokens = staked_tokens + p_amount,
      updated_at = now()
  WHERE user_id = v_user_id;

  -- 5. Initialize or update reward state
  INSERT INTO staking_reward_state (user_id, staked_pip)
  VALUES (v_user_id, p_amount)
  ON CONFLICT (user_id) DO UPDATE
  SET staked_pip = staking_reward_state.staked_pip + p_amount,
      updated_at = now();

  -- 6. Log event
  INSERT INTO staking_events (user_id, event_type, amount_pip, position_id, metadata)
  VALUES (
    v_user_id, 'STAKE', p_amount, v_position_id,
    jsonb_build_object(
      'tier_level', v_tier_level,
      'tier_multiplier', v_tier_multiplier,
      'duration_days', p_duration_days
    )
  );

  -- 7. Log to token ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  )
  SELECT
    v_user_id, 'stake', -p_amount,
    (total_tokens - locked_tokens - staked_tokens),
    'Staked ' || p_amount || ' PIP for ' || p_duration_days || ' days (weight: ' || v_tier_multiplier || 'x)',
    v_position_id, 'staking_position'
  FROM club_token_balances
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'position_id', v_position_id,
    'amount_staked', p_amount,
    'tier_multiplier', v_tier_multiplier,
    'unlock_at', now() + (p_duration_days || ' days')::INTERVAL
  );
END;
$$;

-- ============================================================
-- PART 6: Create request_unstake RPC
-- ============================================================

CREATE OR REPLACE FUNCTION request_unstake(p_position_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_position RECORD;
  v_unlock_time TIMESTAMPTZ;
BEGIN
  -- 1. Get position details
  SELECT * INTO v_position
  FROM club_staking_positions
  WHERE id = p_position_id
    AND user_id = v_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Position not found or not active'
    );
  END IF;

  -- 2. Check minimum 7-day lock
  IF v_position.staked_at + INTERVAL '7 days' > now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Minimum 7-day lock period not met',
      'can_unstake_at', v_position.staked_at + INTERVAL '7 days'
    );
  END IF;

  -- 3. Set unlock time to 24 hours from now
  v_unlock_time := now() + INTERVAL '24 hours';

  -- 4. Update position status
  UPDATE club_staking_positions
  SET status = 'unstake_requested',
      unstake_requested_at = now(),
      unlock_at = v_unlock_time,
      updated_at = now()
  WHERE id = p_position_id;

  -- 5. Log event
  INSERT INTO staking_events (user_id, event_type, amount_pip, position_id, metadata)
  VALUES (
    v_user_id, 'UNSTAKE_REQUEST', v_position.amount_staked, p_position_id,
    jsonb_build_object(
      'unlock_at', v_unlock_time,
      'rewards_earned', v_position.rewards_earned
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'position_id', p_position_id,
    'status', 'unstake_requested',
    'unlock_at', v_unlock_time,
    'rewards_earned', v_position.rewards_earned
  );
END;
$$;

-- ============================================================
-- PART 7: Create execute_unstake RPC
-- ============================================================

CREATE OR REPLACE FUNCTION execute_unstake(p_position_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_position RECORD;
  v_total_to_return NUMERIC;
BEGIN
  -- 1. Get position details
  SELECT * INTO v_position
  FROM club_staking_positions
  WHERE id = p_position_id
    AND user_id = v_user_id
    AND status = 'unstake_requested';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Position not found or unstake not requested'
    );
  END IF;

  -- 2. Check cooldown period
  IF v_position.unlock_at > now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cooldown period not complete',
      'unlock_at', v_position.unlock_at,
      'remaining_seconds', EXTRACT(EPOCH FROM (v_position.unlock_at - now()))
    );
  END IF;

  v_total_to_return := v_position.amount_staked + COALESCE(v_position.rewards_earned, 0);

  -- 3. Update position status
  UPDATE club_staking_positions
  SET status = 'unlocked',
      updated_at = now()
  WHERE id = p_position_id;

  -- 4. Move staked tokens back to liquid
  UPDATE club_token_balances
  SET staked_tokens = GREATEST(staked_tokens - v_position.amount_staked, 0),
      updated_at = now()
  WHERE user_id = v_user_id;

  -- 5. Move rewards from pending to liquid (if any rewards earned)
  IF v_position.rewards_earned > 0 THEN
    UPDATE club_token_balances
    SET reward_tokens_pending = GREATEST(reward_tokens_pending - v_position.rewards_earned, 0),
        updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  -- 6. Update reward state
  UPDATE staking_reward_state
  SET staked_pip = GREATEST(staked_pip - v_position.amount_staked, 0),
      pending_rewards_pip = GREATEST(pending_rewards_pip - COALESCE(v_position.rewards_earned, 0), 0),
      updated_at = now()
  WHERE user_id = v_user_id;

  -- 7. Log event
  INSERT INTO staking_events (user_id, event_type, amount_pip, position_id, metadata)
  VALUES (
    v_user_id, 'UNSTAKE_EXECUTE', v_total_to_return, p_position_id,
    jsonb_build_object(
      'principal', v_position.amount_staked,
      'rewards', v_position.rewards_earned
    )
  );

  -- 8. Log to token ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type
  )
  SELECT
    v_user_id, 'unstake', v_total_to_return,
    (total_tokens - locked_tokens - staked_tokens),
    'Unstaked ' || v_position.amount_staked || ' PIP + ' || COALESCE(v_position.rewards_earned, 0) || ' PIP rewards',
    p_position_id, 'staking_position'
  FROM club_token_balances
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'position_id', p_position_id,
    'principal_returned', v_position.amount_staked,
    'rewards_returned', v_position.rewards_earned,
    'total_returned', v_total_to_return
  );
END;
$$;

-- ============================================================
-- PART 8: Create claim_staking_rewards RPC
-- ============================================================

CREATE OR REPLACE FUNCTION claim_staking_rewards()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pending_rewards NUMERIC;
  v_claimed_total NUMERIC;
BEGIN
  -- 1. Get pending rewards from all active positions
  SELECT COALESCE(SUM(rewards_earned), 0)
  INTO v_pending_rewards
  FROM club_staking_positions
  WHERE user_id = v_user_id
    AND status = 'active'
    AND rewards_earned > 0;

  IF v_pending_rewards <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No rewards available to claim'
    );
  END IF;

  -- 2. Reset rewards on all positions
  UPDATE club_staking_positions
  SET rewards_earned = 0,
      updated_at = now()
  WHERE user_id = v_user_id
    AND status = 'active'
    AND rewards_earned > 0;

  -- 3. Move from rewards_pending to liquid (total_tokens)
  UPDATE club_token_balances
  SET reward_tokens_pending = GREATEST(reward_tokens_pending - v_pending_rewards, 0),
      updated_at = now()
  WHERE user_id = v_user_id;

  -- 4. Update reward state
  UPDATE staking_reward_state
  SET pending_rewards_pip = 0,
      claimed_rewards_total_pip = claimed_rewards_total_pip + v_pending_rewards,
      last_claim_ts = now(),
      updated_at = now()
  WHERE user_id = v_user_id
  RETURNING claimed_rewards_total_pip INTO v_claimed_total;

  -- 5. Log event
  INSERT INTO staking_events (user_id, event_type, amount_pip, metadata)
  VALUES (
    v_user_id, 'REWARD_CLAIM', v_pending_rewards,
    jsonb_build_object('total_claimed_lifetime', v_claimed_total)
  );

  -- 6. Log to token ledger
  INSERT INTO club_token_ledger (
    user_id, transaction_type, amount, balance_after,
    description, reference_type
  )
  SELECT
    v_user_id, 'reward_claim', v_pending_rewards,
    (total_tokens - locked_tokens - staked_tokens),
    'Claimed ' || v_pending_rewards || ' PIP staking rewards',
    'staking_reward'
  FROM club_token_balances
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'rewards_claimed', v_pending_rewards,
    'total_claimed_lifetime', v_claimed_total
  );
END;
$$;

-- ============================================================
-- PART 9: Create distribute_staking_emissions_v2 (Roll-Forward)
-- ============================================================

CREATE OR REPLACE FUNCTION distribute_staking_emissions_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_emission_state RECORD;
  v_daily_emission NUMERIC(18,4);
  v_total_weighted NUMERIC(18,4) := 0;
  v_total_distributed NUMERIC(18,4) := 0;
  v_remainder NUMERIC(18,4) := 0;
  v_staker_count INTEGER := 0;
  v_run_id UUID;
  v_staker RECORD;
  v_reward NUMERIC(18,4);
BEGIN
  -- 1. Check idempotency
  IF EXISTS (
    SELECT 1 FROM club_emission_runs 
    WHERE run_date = v_today AND status = 'completed'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Emissions already distributed today'
    );
  END IF;

  -- 2. Get emission state
  SELECT * INTO v_emission_state
  FROM staking_emission_state
  WHERE id = 1
  FOR UPDATE;

  -- 3. Check pool remaining
  IF v_emission_state.pool_remaining_pip <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Emission pool exhausted'
    );
  END IF;

  -- 4. Calculate daily emission (base + carryover)
  v_daily_emission := v_emission_state.daily_emission_base_pip + v_emission_state.carryover_pip;

  -- Cap by remaining pool
  IF v_daily_emission > v_emission_state.pool_remaining_pip THEN
    v_daily_emission := v_emission_state.pool_remaining_pip;
  END IF;

  -- 5. Calculate total weighted stake (ACTIVE positions only)
  SELECT COALESCE(SUM(sp.amount_staked * sp.tier_weight), 0)
  INTO v_total_weighted
  FROM club_staking_positions sp
  WHERE sp.status = 'active';

  -- 6. Create emission run record
  INSERT INTO club_emission_runs (run_date, status)
  VALUES (v_today, 'pending')
  RETURNING id INTO v_run_id;

  -- 7. Handle zero stakers case (full carryover)
  IF v_total_weighted <= 0 THEN
    UPDATE staking_emission_state
    SET carryover_pip = carryover_pip + v_daily_emission,
        last_accrual_date = v_today,
        updated_at = now()
    WHERE id = 1;

    UPDATE club_emission_runs
    SET status = 'completed',
        total_distributed = 0,
        staker_count = 0,
        metadata = jsonb_build_object(
          'reason', 'No active stakers',
          'carryover_added', v_daily_emission
        )
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
      'success', true,
      'distributed', 0,
      'reason', 'No active stakers - full carryover',
      'new_carryover', v_emission_state.carryover_pip + v_daily_emission
    );
  END IF;

  -- 8. Distribute rewards proportionally
  FOR v_staker IN
    SELECT 
      sp.id AS position_id,
      sp.user_id,
      sp.amount_staked,
      sp.tier_weight,
      (sp.amount_staked * sp.tier_weight) AS weighted_stake
    FROM club_staking_positions sp
    WHERE sp.status = 'active'
    ORDER BY weighted_stake DESC
  LOOP
    -- Calculate proportional reward
    v_reward := FLOOR(
      ((v_staker.weighted_stake / v_total_weighted) * v_daily_emission) * 10000
    ) / 10000;

    IF v_reward < 0.0001 THEN
      CONTINUE;
    END IF;

    -- Update position rewards
    UPDATE club_staking_positions
    SET rewards_earned = COALESCE(rewards_earned, 0) + v_reward,
        last_reward_at = now(),
        updated_at = now()
    WHERE id = v_staker.position_id;

    -- Add to reward_tokens_pending bucket
    UPDATE club_token_balances
    SET reward_tokens_pending = reward_tokens_pending + v_reward,
        lifetime_earned = lifetime_earned + v_reward,
        updated_at = now()
    WHERE user_id = v_staker.user_id;

    -- Update reward state
    INSERT INTO staking_reward_state (user_id, pending_rewards_pip, last_accrual_ts)
    VALUES (v_staker.user_id, v_reward, now())
    ON CONFLICT (user_id) DO UPDATE
    SET pending_rewards_pip = staking_reward_state.pending_rewards_pip + v_reward,
        last_accrual_ts = now(),
        updated_at = now();

    -- Log event
    INSERT INTO staking_events (user_id, event_type, amount_pip, position_id, metadata)
    VALUES (
      v_staker.user_id, 'REWARD_ACCRUE', v_reward, v_staker.position_id,
      jsonb_build_object(
        'run_id', v_run_id,
        'weight', v_staker.tier_weight,
        'weighted_stake', v_staker.weighted_stake
      )
    );

    v_total_distributed := v_total_distributed + v_reward;
    v_staker_count := v_staker_count + 1;
  END LOOP;

  -- 9. Calculate remainder for carryover
  v_remainder := v_daily_emission - v_total_distributed;

  -- 10. Update emission state
  UPDATE staking_emission_state
  SET carryover_pip = v_remainder,
      last_accrual_date = v_today,
      total_distributed_lifetime = total_distributed_lifetime + v_total_distributed,
      pool_remaining_pip = pool_remaining_pip - v_total_distributed,
      updated_at = now()
  WHERE id = 1;

  -- 11. Finalize emission run
  UPDATE club_emission_runs
  SET status = 'completed',
      total_distributed = v_total_distributed,
      staker_count = v_staker_count,
      pool_remaining = v_emission_state.pool_remaining_pip - v_total_distributed,
      metadata = jsonb_build_object(
        'daily_emission', v_daily_emission,
        'base_emission', v_emission_state.daily_emission_base_pip,
        'carryover_in', v_emission_state.carryover_pip,
        'total_weighted_stake', v_total_weighted,
        'actual_distributed', v_total_distributed,
        'remainder_carryover', v_remainder,
        'stakers_rewarded', v_staker_count
      )
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'daily_emission', v_daily_emission,
    'distributed', v_total_distributed,
    'carryover_out', v_remainder,
    'staker_count', v_staker_count,
    'pool_remaining', v_emission_state.pool_remaining_pip - v_total_distributed
  );
END;
$$;

-- ============================================================
-- PART 10: Admin Analytics RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION get_staking_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_emission_state RECORD;
BEGIN
  -- Check admin
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  SELECT * INTO v_emission_state
  FROM staking_emission_state
  WHERE id = 1;

  SELECT jsonb_build_object(
    'total_active_staked', COALESCE(SUM(CASE WHEN status = 'active' THEN amount_staked ELSE 0 END), 0),
    'total_unstake_requested', COALESCE(SUM(CASE WHEN status = 'unstake_requested' THEN amount_staked ELSE 0 END), 0),
    'total_pending_rewards', COALESCE(SUM(CASE WHEN status = 'active' THEN rewards_earned ELSE 0 END), 0),
    'active_stakers', COUNT(DISTINCT CASE WHEN status = 'active' THEN user_id END),
    'unstake_pending', COUNT(DISTINCT CASE WHEN status = 'unstake_requested' THEN user_id END),
    'emission_state', jsonb_build_object(
      'daily_base', v_emission_state.daily_emission_base_pip,
      'carryover', v_emission_state.carryover_pip,
      'pool_remaining', v_emission_state.pool_remaining_pip,
      'last_accrual', v_emission_state.last_accrual_date,
      'total_distributed_lifetime', v_emission_state.total_distributed_lifetime
    ),
    'last_run', (
      SELECT jsonb_build_object(
        'date', run_date,
        'distributed', total_distributed,
        'staker_count', staker_count,
        'metadata', metadata
      )
      FROM club_emission_runs
      WHERE status = 'completed'
      ORDER BY run_date DESC
      LIMIT 1
    )
  ) INTO v_result
  FROM club_staking_positions;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_staking_summary(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_user UUID;
  v_result JSONB;
BEGIN
  v_target_user := COALESCE(p_user_id, auth.uid());
  
  -- Users can only view their own unless admin
  IF v_target_user != auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() AND is_admin = true
    ) THEN
      RETURN jsonb_build_object('error', 'Access denied');
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'active_positions', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'position_id', id,
          'amount_staked', amount_staked,
          'tier_weight', tier_weight,
          'rewards_earned', rewards_earned,
          'staked_at', staked_at,
          'unlock_at', unlock_at,
          'status', status,
          'unstake_requested_at', unstake_requested_at,
          'can_unstake', CASE 
            WHEN status = 'active' AND staked_at + INTERVAL '7 days' <= now() THEN true
            WHEN status = 'unstake_requested' AND unlock_at <= now() THEN true
            ELSE false
          END
        )
        ORDER BY staked_at DESC
      ) FILTER (WHERE status IN ('active', 'unstake_requested')),
      '[]'::jsonb
    ),
    'reward_state', (
      SELECT jsonb_build_object(
        'staked_pip', staked_pip,
        'pending_rewards_pip', pending_rewards_pip,
        'claimed_total_pip', claimed_rewards_total_pip,
        'last_accrual_ts', last_accrual_ts,
        'last_claim_ts', last_claim_ts
      )
      FROM staking_reward_state
      WHERE user_id = v_target_user
    ),
    'lifetime_stats', (
      SELECT jsonb_build_object(
        'total_staked_events', COUNT(*) FILTER (WHERE event_type = 'STAKE'),
        'total_unstaked_events', COUNT(*) FILTER (WHERE event_type = 'UNSTAKE_EXECUTE'),
        'total_rewards_claimed', COALESCE(SUM(amount_pip) FILTER (WHERE event_type = 'REWARD_CLAIM'), 0)
      )
      FROM staking_events
      WHERE user_id = v_target_user
    )
  ) INTO v_result
  FROM club_staking_positions
  WHERE user_id = v_target_user;

  RETURN v_result;
END;
$$;
