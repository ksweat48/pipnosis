/*
  # CCIP-2026-0501F — Stages 15 & 16: Auto-Tuned Baselines + Pair Personality Drift

  ## Purpose
  Stage 15 replaces hard-coded watcher thresholds with adaptive baselines so
  Alpha is measured against his own platform equilibrium. Stage 16 surfaces
  when observed noise floors diverge from declared pair personalities.

  ## What This Migration Adds

  ### Stage 15 — Auto-Tuned Watcher Thresholds
  - New table `alpha_watcher_baselines` — per observation_type, stores
    rolling-30d mean, stdev, current threshold, cold-start fallback, and an
    active kill switch.
  - New RPC `recompute_watcher_baselines()` — reads the history of watcher
    runs and recomputes mean/stdev per metric. Adaptive threshold = mean + k*stdev
    clamped by hard floor/ceiling.
  - New RPC `get_watcher_threshold(p_observation_type)` — watchers consult
    this before deciding to fire. Returns hard-coded fallback during cold
    start (< 30 runs).

  ### Stage 16 — Pair-Personality Drift Detection
  - New table `alpha_pair_declared_floors` — machine-readable mirror of the
    human-authored personality file noise floors.
  - New table `alpha_pair_noise_observations` — captures observed sweep
    magnitudes / wick sizes from closed trades.
  - New RPC `detect_pair_personality_drift()` — compares observed p90 sweep
    magnitude to declared floor. Emits PAIR_PERSONALITY_DRIFT observation
    with suggested_floor_pips when divergence persists.
  - The human-authored pair-personalities.ts file remains the SSOT. Drift
    surfaces for human review; no code auto-rewrites personalities.

  ## Safety
  - Stage 15 hard floor/ceiling clamps prevent runaway thresholds (e.g.
    NO_TRADE threshold can never be raised above 25%).
  - Kill-switch (active=false) reverts that baseline to static fallback.
  - Cold-start fallback during the first 30 runs preserves existing behavior.
  - Stage 16 emits suggestions; never mutates pair-personalities.ts.
*/

-- ────────────────────────────────────────────────────────────────────────
-- Stage 15 — alpha_watcher_baselines
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_watcher_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type text UNIQUE NOT NULL,
  metric_description text NOT NULL,
  rolling_mean numeric,
  rolling_stdev numeric,
  sample_size integer NOT NULL DEFAULT 0,
  k_multiplier numeric NOT NULL DEFAULT 1.5,
  static_fallback numeric NOT NULL,
  hard_floor numeric NOT NULL,
  hard_ceiling numeric NOT NULL,
  current_threshold numeric NOT NULL,
  direction text NOT NULL DEFAULT 'upper',
  active boolean NOT NULL DEFAULT true,
  last_recomputed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_direction CHECK (direction IN ('upper', 'lower'))
);

ALTER TABLE alpha_watcher_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages watcher baselines"
  ON alpha_watcher_baselines FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read watcher baselines"
  ON alpha_watcher_baselines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update kill switch"
  ON alpha_watcher_baselines FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

-- Seed the three existing watchers with their hard-coded defaults
INSERT INTO alpha_watcher_baselines (
  observation_type, metric_description,
  static_fallback, hard_floor, hard_ceiling, current_threshold, direction
) VALUES
  ('NO_TRADE_RATE_EXCEEDED', 'Platform-wide NO_TRADE rate percentage — upper bound threshold', 10.0, 5.0, 25.0, 10.0, 'upper'),
  ('TIER_CALIBRATION_DRIFT_VC', 'Very-confident tier platform win rate floor', 60.0, 50.0, 70.0, 60.0, 'lower'),
  ('TIER_CALIBRATION_DRIFT_EC', 'Extremely-confident tier platform win rate floor', 75.0, 65.0, 85.0, 75.0, 'lower'),
  ('EVIDENCE_DENSITY_DRIFT', 'Evidence-density win-rate gap (percentage points)', 15.0, 8.0, 25.0, 15.0, 'upper')
ON CONFLICT (observation_type) DO NOTHING;

CREATE OR REPLACE FUNCTION get_watcher_threshold(p_observation_type text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold numeric;
  v_active boolean;
  v_static numeric;
BEGIN
  SELECT current_threshold, active, static_fallback
  INTO v_threshold, v_active, v_static
  FROM alpha_watcher_baselines
  WHERE observation_type = p_observation_type;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_active = false THEN
    RETURN v_static;
  END IF;

  RETURN v_threshold;
END;
$$;

GRANT EXECUTE ON FUNCTION get_watcher_threshold(text) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION recompute_watcher_baselines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mean numeric;
  v_stdev numeric;
  v_sample integer;
  v_updated integer := 0;
BEGIN
  -- NO_TRADE rate upper threshold
  SELECT AVG(no_trade_rate_pct), STDDEV(no_trade_rate_pct), COUNT(*)
  INTO v_mean, v_stdev, v_sample
  FROM alpha_reasoning_watcher_runs
  WHERE run_at >= now() - interval '30 days' AND no_trade_rate_pct IS NOT NULL;

  IF v_sample >= 30 AND v_mean IS NOT NULL THEN
    UPDATE alpha_watcher_baselines
    SET rolling_mean = v_mean,
        rolling_stdev = v_stdev,
        sample_size = v_sample,
        current_threshold = LEAST(hard_ceiling, GREATEST(hard_floor, v_mean + (k_multiplier * COALESCE(v_stdev, 0)))),
        last_recomputed_at = now()
    WHERE observation_type = 'NO_TRADE_RATE_EXCEEDED';
    v_updated := v_updated + 1;
  END IF;

  -- VC tier win-rate lower threshold
  SELECT AVG(vc_win_rate_pct), STDDEV(vc_win_rate_pct), COUNT(*)
  INTO v_mean, v_stdev, v_sample
  FROM alpha_reasoning_watcher_runs
  WHERE run_at >= now() - interval '30 days' AND vc_win_rate_pct IS NOT NULL;

  IF v_sample >= 30 AND v_mean IS NOT NULL THEN
    UPDATE alpha_watcher_baselines
    SET rolling_mean = v_mean,
        rolling_stdev = v_stdev,
        sample_size = v_sample,
        current_threshold = LEAST(hard_ceiling, GREATEST(hard_floor, v_mean - (k_multiplier * COALESCE(v_stdev, 0)))),
        last_recomputed_at = now()
    WHERE observation_type = 'TIER_CALIBRATION_DRIFT_VC';
    v_updated := v_updated + 1;
  END IF;

  -- EC tier win-rate lower threshold
  SELECT AVG(ec_win_rate_pct), STDDEV(ec_win_rate_pct), COUNT(*)
  INTO v_mean, v_stdev, v_sample
  FROM alpha_reasoning_watcher_runs
  WHERE run_at >= now() - interval '30 days' AND ec_win_rate_pct IS NOT NULL;

  IF v_sample >= 30 AND v_mean IS NOT NULL THEN
    UPDATE alpha_watcher_baselines
    SET rolling_mean = v_mean,
        rolling_stdev = v_stdev,
        sample_size = v_sample,
        current_threshold = LEAST(hard_ceiling, GREATEST(hard_floor, v_mean - (k_multiplier * COALESCE(v_stdev, 0)))),
        last_recomputed_at = now()
    WHERE observation_type = 'TIER_CALIBRATION_DRIFT_EC';
    v_updated := v_updated + 1;
  END IF;

  RETURN v_updated;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'recompute_watcher_baselines failed: %', SQLERRM;
  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_watcher_baselines() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 16 — alpha_pair_declared_floors (machine-readable personality mirror)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_pair_declared_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text UNIQUE NOT NULL,
  style text NOT NULL DEFAULT 'MICRO_INTRADAY',
  declared_floor_pips numeric NOT NULL,
  declared_p90_pips numeric,
  notes text,
  last_updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alpha_pair_declared_floors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages declared floors"
  ON alpha_pair_declared_floors FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read declared floors"
  ON alpha_pair_declared_floors FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

-- Seed from pair-personalities.ts (approximate noise floors declared in that file).
-- These values are a mirror, not the SSOT. pair-personalities.ts remains authoritative.
INSERT INTO alpha_pair_declared_floors (symbol, declared_floor_pips, declared_p90_pips, notes) VALUES
  ('XAUUSD', 3.5, 8.0, 'Gold noise floor is session-dependent (CCIP-2026-0501A). London open ~3.5 pip floor; p90 sweep ~8 pips.'),
  ('EURUSD', 1.5, 3.5, 'Tightest noise floor; crowded pair with frequent micro-sweeps.'),
  ('GBPUSD', 2.0, 5.5, 'Wider sweep habit than EUR; expect p90 up to ~5.5 pips in active sessions.'),
  ('USDJPY', 2.5, 6.0, 'Yen pair — Tokyo session can expand floors. Per-pair calibration required.'),
  ('US30',   15.0, 50.0, 'Dow index — wide natural noise. Floor measured in index points.'),
  ('NAS100', 20.0, 70.0, 'Highest noise of US indices. p90 context-dependent on NY session phase.'),
  ('BTCUSD', 80.0, 300.0, 'Crypto — widest floor 24/7. Round-number sweep magnets.'),
  ('ETHUSD', 5.0, 25.0, 'Crypto — round-number sweeps dominate structure.')
ON CONFLICT (symbol) DO UPDATE SET
  declared_floor_pips = EXCLUDED.declared_floor_pips,
  declared_p90_pips = EXCLUDED.declared_p90_pips,
  notes = EXCLUDED.notes,
  last_updated_at = now();

-- ────────────────────────────────────────────────────────────────────────
-- Stage 16 — detect pair personality drift
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION detect_pair_personality_drift()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_declared_p90 numeric;
  v_declared_floor numeric;
  v_observed_p90 numeric;
  v_observed_median numeric;
  v_sample integer;
  v_lower_bound numeric;
  v_upper_bound numeric;
  v_observations integer := 0;
BEGIN
  -- For every symbol with enough recent trades, compare observed vs declared.
  FOR v_row IN
    SELECT symbol FROM alpha_pair_declared_floors
  LOOP
    SELECT declared_p90_pips, declared_floor_pips
    INTO v_declared_p90, v_declared_floor
    FROM alpha_pair_declared_floors
    WHERE symbol = v_row.symbol;

    IF v_declared_p90 IS NULL THEN
      CONTINUE;
    END IF;

    -- Observed sweep magnitude proxy: max(high-entry, entry-low) during
    -- trade lifetime — measured from closed goal_session_trades in last 30d.
    SELECT
      COUNT(*),
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(GREATEST(
        COALESCE(max_adverse_excursion_pips, 0),
        COALESCE(max_favorable_excursion_pips, 0)
      ))),
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ABS(GREATEST(
        COALESCE(max_adverse_excursion_pips, 0),
        COALESCE(max_favorable_excursion_pips, 0)
      )))
    INTO v_sample, v_observed_median, v_observed_p90
    FROM goal_session_trades
    WHERE symbol = v_row.symbol
      AND status = 'closed'
      AND closed_at >= now() - interval '30 days';

    IF v_sample < 20 THEN
      CONTINUE;
    END IF;

    -- Divergence = observed outside ±25% of declared p90.
    v_lower_bound := v_declared_p90 * 0.75;
    v_upper_bound := v_declared_p90 * 1.25;

    IF v_observed_p90 < v_lower_bound OR v_observed_p90 > v_upper_bound THEN
      PERFORM upsert_ccip_observation(
        'PAIR_PERSONALITY_DRIFT',
        'CCIP-2026-0501F',
        'advisory',
        'pair',
        v_row.symbol,
        NULL,
        format(
          'On %s, observed p90 sweep magnitude %s pips over %s closed trades — declared personality floor p90 is %s pips. Market behaviour has drifted from the declared personality; a human should review pair-personalities.ts for %s.',
          v_row.symbol,
          round(v_observed_p90, 1),
          v_sample,
          round(v_declared_p90, 1),
          v_row.symbol
        ),
        jsonb_build_object(
          'symbol', v_row.symbol,
          'observed_median_pips', round(v_observed_median, 2),
          'observed_p90_pips', round(v_observed_p90, 2),
          'declared_floor_pips', v_declared_floor,
          'declared_p90_pips', v_declared_p90,
          'suggested_floor_pips', round(v_observed_p90 * 0.5, 1),
          'sample_size', v_sample
        ),
        v_sample
      );
      v_observations := v_observations + 1;
    END IF;
  END LOOP;

  RETURN v_observations;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'detect_pair_personality_drift failed: %', SQLERRM;
  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION detect_pair_personality_drift() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Wrap stage 15 + 16 into scheduled run
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION run_and_log_alpha_reasoning_watchers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_result jsonb;
  v_evidence_result jsonb;
  v_per_pair_result jsonb;
  v_targets_updated integer;
  v_patterns_updated integer;
  v_escalations_updated integer;
  v_baselines_updated integer;
  v_personality_drift integer;
BEGIN
  BEGIN v_base_result := run_alpha_reasoning_watchers();
  EXCEPTION WHEN OTHERS THEN v_base_result := jsonb_build_object('error', SQLERRM); END;

  BEGIN v_evidence_result := run_evidence_citation_watcher();
  EXCEPTION WHEN OTHERS THEN v_evidence_result := jsonb_build_object('error', SQLERRM); END;

  BEGIN v_per_pair_result := run_per_pair_tier_watcher();
  EXCEPTION WHEN OTHERS THEN v_per_pair_result := jsonb_build_object('error', SQLERRM); END;

  BEGIN v_targets_updated := recompute_alpha_tier_targets();
  EXCEPTION WHEN OTHERS THEN v_targets_updated := 0; END;

  BEGIN v_patterns_updated := recompute_winning_patterns();
  EXCEPTION WHEN OTHERS THEN v_patterns_updated := 0; END;

  BEGIN v_escalations_updated := recompute_observation_escalation();
  EXCEPTION WHEN OTHERS THEN v_escalations_updated := 0; END;

  BEGIN v_baselines_updated := recompute_watcher_baselines();
  EXCEPTION WHEN OTHERS THEN v_baselines_updated := 0; END;

  BEGIN v_personality_drift := detect_pair_personality_drift();
  EXCEPTION WHEN OTHERS THEN v_personality_drift := 0; END;

  INSERT INTO alpha_reasoning_watcher_runs (
    run_at,
    observations_created,
    no_trade_rate_pct, no_trade_sample,
    vc_win_rate_pct, vc_sample,
    ec_win_rate_pct, ec_sample,
    counter_trend_violations,
    per_pair_observations_created,
    per_pair_drift_summary,
    tier_targets_recomputed,
    raw_result
  )
  VALUES (
    now(),
    COALESCE((v_base_result->>'observations_created')::int, 0)
      + COALESCE((v_evidence_result->>'observations_created')::int, 0)
      + COALESCE((v_per_pair_result->>'observations_created')::int, 0)
      + COALESCE(v_personality_drift, 0),
    COALESCE((v_base_result->>'no_trade_rate_pct')::numeric, NULL),
    COALESCE((v_base_result->>'no_trade_sample')::int, NULL),
    COALESCE((v_base_result->>'vc_win_rate_pct')::numeric, NULL),
    COALESCE((v_base_result->>'vc_sample')::int, NULL),
    COALESCE((v_base_result->>'ec_win_rate_pct')::numeric, NULL),
    COALESCE((v_base_result->>'ec_sample')::int, NULL),
    COALESCE((v_base_result->>'counter_trend_violations')::int, NULL),
    COALESCE((v_per_pair_result->>'observations_created')::int, 0) + COALESCE(v_personality_drift, 0),
    COALESCE(v_per_pair_result->'pair_summary', '[]'::jsonb),
    COALESCE(v_targets_updated, 0),
    jsonb_build_object(
      'base', v_base_result,
      'evidence', v_evidence_result,
      'per_pair', v_per_pair_result,
      'tier_targets_updated', v_targets_updated,
      'winning_patterns_updated', v_patterns_updated,
      'escalations_updated', v_escalations_updated,
      'baselines_updated', v_baselines_updated,
      'personality_drift_observations', v_personality_drift
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'run_and_log_alpha_reasoning_watchers wrapper failed: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION run_and_log_alpha_reasoning_watchers() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Audit deployment
-- ────────────────────────────────────────────────────────────────────────

INSERT INTO ccip_alpha_prompt_deployments (
  deployed_at, change_type, affected_file, affected_function,
  change_description, governance_notes, fix_count
) VALUES (
  now(),
  'ALPHA_BRAIN_UPGRADE_STAGE_15_16',
  'supabase/migrations/20260501_ccip_2026_0501f_stage15_16.sql',
  'recompute_watcher_baselines / get_watcher_threshold / detect_pair_personality_drift / alpha_watcher_baselines / alpha_pair_declared_floors',
  'Stage 15 adds adaptive watcher thresholds with hard floor/ceiling clamps and admin kill switches. Stage 16 detects pair personality drift vs declared noise floors and surfaces suggestions for human review. No execution gates added.',
  'CCIP-2026-0501F. pair-personalities.ts remains the human-authored SSOT; stage 16 drift is advisory only. Stage 15 kill switch (alpha_watcher_baselines.active=false) reverts to static fallback instantly.',
  2
);
