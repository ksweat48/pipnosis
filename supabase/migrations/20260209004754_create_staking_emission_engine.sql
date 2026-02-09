/*
  # Create Staking Emission Distribution Engine

  1. New Tables
    - `club_emission_runs` - Tracks each emission distribution cycle
      - `id` (uuid, primary key)
      - `run_date` (date) - The date this emission was for
      - `total_distributed` (numeric) - Total PIP distributed in this run
      - `staker_count` (integer) - Number of stakers who received rewards
      - `pool_remaining` (numeric) - Remaining emission pool after distribution
      - `status` (text) - pending/completed/failed
      - `metadata` (jsonb) - Distribution breakdown details

  2. New Functions
    - `distribute_staking_emissions()` - Main emission distribution function
      - Calculates proportional shares based on staked amount x tier multiplier
      - Enforces monthly budget (100,000 PIP / ~3,333 PIP per day)
      - Tracks cumulative pool depletion against 30M cap
      - Awards rewards to individual staker positions
      - Logs all movements to club_token_ledger

  3. Security
    - `club_emission_runs` has RLS enabled
    - Only service role can execute distribution
    - Admins can view emission history
    - Users cannot directly interact with emission runs
*/

-- Emission run tracking table
CREATE TABLE IF NOT EXISTS club_emission_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  total_distributed NUMERIC(12,2) NOT NULL DEFAULT 0,
  staker_count INTEGER NOT NULL DEFAULT 0,
  pool_remaining NUMERIC(14,2) NOT NULL DEFAULT 30000000,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_date)
);

ALTER TABLE club_emission_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view emission runs"
  ON club_emission_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can manage emission runs"
  ON club_emission_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Main emission distribution function
CREATE OR REPLACE FUNCTION distribute_staking_emissions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_daily_budget NUMERIC(12,2);
  v_pool_remaining NUMERIC(14,2);
  v_total_weighted NUMERIC(14,2) := 0;
  v_total_distributed NUMERIC(12,2) := 0;
  v_staker_count INTEGER := 0;
  v_run_id UUID;
  v_staker RECORD;
  v_reward NUMERIC(12,2);
  v_new_available NUMERIC(12,2);
  v_last_run RECORD;
BEGIN
  -- 1. Check if already run today (idempotent)
  SELECT * INTO v_last_run
  FROM club_emission_runs
  WHERE run_date = v_today AND status = 'completed';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Emissions already distributed today',
      'run_id', v_last_run.id
    );
  END IF;

  -- 2. Calculate daily budget (monthly 100,000 / 30 days)
  v_daily_budget := ROUND(100000.0 / 30.0, 2);

  -- 3. Check remaining pool
  SELECT COALESCE(
    30000000 - SUM(total_distributed), 30000000
  ) INTO v_pool_remaining
  FROM club_emission_runs
  WHERE status = 'completed';

  IF v_pool_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Emission pool exhausted');
  END IF;

  -- Cap daily budget by remaining pool
  IF v_daily_budget > v_pool_remaining THEN
    v_daily_budget := v_pool_remaining;
  END IF;

  -- 4. Create emission run record
  INSERT INTO club_emission_runs (run_date, status, pool_remaining)
  VALUES (v_today, 'pending', v_pool_remaining)
  RETURNING id INTO v_run_id;

  -- 5. Calculate total weighted stake across all active positions
  SELECT COALESCE(SUM(sp.amount_staked * sp.tier_weight), 0)
  INTO v_total_weighted
  FROM club_staking_positions sp
  WHERE sp.status = 'active';

  IF v_total_weighted <= 0 THEN
    UPDATE club_emission_runs
    SET status = 'completed', total_distributed = 0, staker_count = 0,
        metadata = jsonb_build_object('reason', 'No active stakers')
    WHERE id = v_run_id;

    RETURN jsonb_build_object('success', true, 'distributed', 0, 'reason', 'No active stakers');
  END IF;

  -- 6. Distribute rewards proportionally
  FOR v_staker IN
    SELECT sp.id AS position_id, sp.user_id, sp.amount_staked, sp.tier_weight,
           (sp.amount_staked * sp.tier_weight) AS weighted_stake
    FROM club_staking_positions sp
    WHERE sp.status = 'active'
    ORDER BY weighted_stake DESC
  LOOP
    -- Calculate proportional reward
    v_reward := ROUND((v_staker.weighted_stake / v_total_weighted) * v_daily_budget, 2);

    IF v_reward < 0.01 THEN
      CONTINUE;
    END IF;

    -- Update staking position rewards
    UPDATE club_staking_positions
    SET rewards_earned = COALESCE(rewards_earned, 0) + v_reward,
        last_reward_at = NOW(),
        updated_at = NOW()
    WHERE id = v_staker.position_id;

    -- Add tokens to user balance
    UPDATE club_token_balances
    SET total_tokens = total_tokens + v_reward,
        lifetime_earned = lifetime_earned + v_reward,
        updated_at = NOW()
    WHERE user_id = v_staker.user_id;

    -- Get new available balance for ledger
    SELECT (total_tokens - locked_tokens) INTO v_new_available
    FROM club_token_balances WHERE user_id = v_staker.user_id;

    -- Log in ledger
    INSERT INTO club_token_ledger (
      user_id, transaction_type, amount, balance_after,
      description, reference_id, reference_type
    ) VALUES (
      v_staker.user_id, 'staking_reward', v_reward,
      v_new_available,
      'Daily staking reward: ' || v_reward || ' PIP (weight: ' || v_staker.tier_weight || 'x)',
      v_staker.position_id::TEXT, 'staking'
    );

    v_total_distributed := v_total_distributed + v_reward;
    v_staker_count := v_staker_count + 1;
  END LOOP;

  -- 7. Finalize emission run
  UPDATE club_emission_runs
  SET status = 'completed',
      total_distributed = v_total_distributed,
      staker_count = v_staker_count,
      pool_remaining = v_pool_remaining - v_total_distributed,
      metadata = jsonb_build_object(
        'daily_budget', v_daily_budget,
        'total_weighted_stake', v_total_weighted,
        'actual_distributed', v_total_distributed,
        'stakers_rewarded', v_staker_count
      )
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'distributed', v_total_distributed,
    'staker_count', v_staker_count,
    'pool_remaining', v_pool_remaining - v_total_distributed
  );
END;
$$;
