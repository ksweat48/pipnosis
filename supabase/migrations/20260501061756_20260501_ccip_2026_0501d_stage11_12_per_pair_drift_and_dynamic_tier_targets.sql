/*
  # CCIP-2026-0501D — Stages 11 & 12: Per-Pair Drift + Dynamic Tier Targets

  ## Purpose
  Extends the Alpha reasoning self-healing loop so drift is detected per
  symbol × style × tier (not only platform-wide) and tier-target win rates
  become pair-aware adaptive numbers instead of hard-coded 65% / 80% anchors.

  ## What This Migration Adds

  ### Stage 11 — Per-Pair × Per-Tier Drift Watchers
  - New RPC `run_per_pair_tier_watcher()` groups `alpha_decisions` joined to
    `alpha_decision_outcomes` by (symbol, style, confidence_tier) over a 14-day
    window. Emits `PAIR_TIER_CALIBRATION_DRIFT` observations with scope='pair'
    so the coordinator can filter to the scan's symbol × style.
  - Observation is pure reasoning feedback — it never blocks execution.

  ### Stage 12 — Dynamic Tier Targets
  - New table `alpha_tier_targets` stores a shrinkage-estimated win-rate target
    per (symbol, style, tier). Static anchors (65/80) remain untouched — the
    dynamic target is a SECOND mirror shown alongside the static anchor.
  - New RPC `recompute_alpha_tier_targets()` blends realized win rate toward
    the static anchor when sample is small; trusts realized fully when large.
  - New RPC `get_current_tier_targets(p_symbol, p_style)` returns per-tier
    dynamic targets and anchors for the coordinator to inject.
  - Floor/ceiling clamp: dynamic target never drifts more than ±15pp from the
    static anchor. Minimum sample size 30 before the dynamic value is trusted.

  ## Safety
  - Existing watcher `run_alpha_reasoning_watchers()` is unchanged.
  - Existing `run_and_log_alpha_reasoning_watchers()` is extended to call the
    new per-pair watcher and persist sample counts alongside existing metrics.
  - All new RPCs are SECURITY DEFINER with service_role EXECUTE.
  - Tier labeling does not change lot sizing — user's riskMode / riskPercent
    remains the SSOT for dollar exposure.

  ## Schema Changes
  1. `alpha_tier_targets` — new table
  2. `alpha_reasoning_watcher_runs` — add columns: per_pair_observations_created, per_pair_drift_summary (jsonb)
*/

-- ────────────────────────────────────────────────────────────────────────
-- Stage 12 — alpha_tier_targets table
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_tier_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  style text NOT NULL,
  tier text NOT NULL,
  static_anchor_pct numeric(5,2) NOT NULL,
  trailing_realized_pct numeric(5,2) NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  current_target_pct numeric(5,2) NOT NULL,
  clamp_floor_pct numeric(5,2) NOT NULL,
  clamp_ceiling_pct numeric(5,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_recomputed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, style, tier)
);

CREATE INDEX IF NOT EXISTS idx_alpha_tier_targets_lookup
  ON alpha_tier_targets (symbol, style, tier)
  WHERE active = true;

ALTER TABLE alpha_tier_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages tier targets"
  ON alpha_tier_targets FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated admins can read tier targets"
  ON alpha_tier_targets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.is_admin = true
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- Stage 11/12 — extend watcher run log with pair-scoped counters
-- ────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_reasoning_watcher_runs' AND column_name = 'per_pair_observations_created'
  ) THEN
    ALTER TABLE alpha_reasoning_watcher_runs ADD COLUMN per_pair_observations_created integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_reasoning_watcher_runs' AND column_name = 'per_pair_drift_summary'
  ) THEN
    ALTER TABLE alpha_reasoning_watcher_runs ADD COLUMN per_pair_drift_summary jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_reasoning_watcher_runs' AND column_name = 'tier_targets_recomputed'
  ) THEN
    ALTER TABLE alpha_reasoning_watcher_runs ADD COLUMN tier_targets_recomputed integer DEFAULT 0;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 12 — recompute dynamic tier targets
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_alpha_tier_targets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_static_anchor numeric;
  v_realized numeric;
  v_sample integer;
  v_shrinkage_weight numeric;
  v_blended numeric;
  v_floor numeric;
  v_ceiling numeric;
  v_final numeric;
  v_updated integer := 0;
BEGIN
  -- Iterate over every (symbol, style, tier) with outcomes in the last 30 days
  FOR v_row IN
    SELECT
      ad.symbol,
      COALESCE(ad.trade_style, 'MICRO_INTRADAY') AS style,
      ad.confidence_tier AS tier,
      COUNT(*)::int AS sample_size,
      AVG(CASE WHEN ado.outcome = 'WIN' THEN 100.0 ELSE 0 END)::numeric AS realized_pct
    FROM alpha_decisions ad
    JOIN alpha_decision_outcomes ado ON ado.decision_id = ad.id
    WHERE ad.created_at >= now() - interval '30 days'
      AND ad.symbol IS NOT NULL
      AND ad.confidence_tier IN ('confident', 'very_confident', 'extremely_confident')
      AND ado.outcome IN ('WIN', 'LOSS')
      AND ado.executed = true
    GROUP BY ad.symbol, COALESCE(ad.trade_style, 'MICRO_INTRADAY'), ad.confidence_tier
  LOOP
    -- Static anchor from the SSOT rubric (alpha-identity.ts mirror)
    v_static_anchor := CASE v_row.tier
      WHEN 'extremely_confident' THEN 80.0
      WHEN 'very_confident' THEN 65.0
      WHEN 'confident' THEN 55.0
      ELSE 50.0
    END;

    v_sample := v_row.sample_size;
    v_realized := v_row.realized_pct;

    -- Shrinkage: weight = n / (n + 30). At n=30, realized gets 50% weight.
    -- At n=60, realized gets 67% weight. At n<10, realized barely moves the anchor.
    v_shrinkage_weight := v_sample::numeric / (v_sample + 30)::numeric;
    v_blended := (v_shrinkage_weight * v_realized) + ((1 - v_shrinkage_weight) * v_static_anchor);

    -- Floor/ceiling clamp: ±15pp from the static anchor
    v_floor := GREATEST(0, v_static_anchor - 15);
    v_ceiling := LEAST(100, v_static_anchor + 15);
    v_final := LEAST(v_ceiling, GREATEST(v_floor, v_blended));

    INSERT INTO alpha_tier_targets (
      symbol, style, tier,
      static_anchor_pct, trailing_realized_pct, sample_size, current_target_pct,
      clamp_floor_pct, clamp_ceiling_pct, last_recomputed_at
    ) VALUES (
      v_row.symbol, v_row.style, v_row.tier,
      v_static_anchor, v_realized, v_sample, v_final,
      v_floor, v_ceiling, now()
    )
    ON CONFLICT (symbol, style, tier) DO UPDATE SET
      static_anchor_pct = EXCLUDED.static_anchor_pct,
      trailing_realized_pct = EXCLUDED.trailing_realized_pct,
      sample_size = EXCLUDED.sample_size,
      current_target_pct = EXCLUDED.current_target_pct,
      clamp_floor_pct = EXCLUDED.clamp_floor_pct,
      clamp_ceiling_pct = EXCLUDED.clamp_ceiling_pct,
      last_recomputed_at = now();

    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'recompute_alpha_tier_targets failed: %', SQLERRM;
  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_alpha_tier_targets() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 12 — expose current targets to the coordinator
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_current_tier_targets(
  p_symbol text,
  p_style text
)
RETURNS TABLE (
  tier text,
  static_anchor_pct numeric,
  current_target_pct numeric,
  trailing_realized_pct numeric,
  sample_size integer,
  trusted boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tier,
    static_anchor_pct,
    current_target_pct,
    trailing_realized_pct,
    sample_size,
    (sample_size >= 30) AS trusted
  FROM alpha_tier_targets
  WHERE symbol = p_symbol
    AND style = p_style
    AND active = true
  ORDER BY CASE tier
    WHEN 'extremely_confident' THEN 1
    WHEN 'very_confident' THEN 2
    WHEN 'confident' THEN 3
    ELSE 4
  END;
$$;

GRANT EXECUTE ON FUNCTION get_current_tier_targets(text, text) TO service_role, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 11 — per-pair × per-tier drift watcher
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION run_per_pair_tier_watcher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_target numeric;
  v_observations integer := 0;
  v_pair_summary jsonb := '[]'::jsonb;
  v_entry jsonb;
BEGIN
  FOR v_row IN
    SELECT
      ad.symbol,
      COALESCE(ad.trade_style, 'MICRO_INTRADAY') AS style,
      ad.confidence_tier AS tier,
      COUNT(*)::int AS sample_size,
      SUM(CASE WHEN ado.outcome = 'WIN' THEN 1 ELSE 0 END)::int AS wins,
      AVG(CASE WHEN ado.outcome = 'WIN' THEN 100.0 ELSE 0 END)::numeric AS win_rate_pct
    FROM alpha_decisions ad
    JOIN alpha_decision_outcomes ado ON ado.decision_id = ad.id
    WHERE ad.created_at >= now() - interval '14 days'
      AND ad.symbol IS NOT NULL
      AND ad.confidence_tier IN ('very_confident', 'extremely_confident')
      AND ado.outcome IN ('WIN', 'LOSS')
      AND ado.executed = true
    GROUP BY ad.symbol, COALESCE(ad.trade_style, 'MICRO_INTRADAY'), ad.confidence_tier
    HAVING COUNT(*) >= 15
  LOOP
    -- Prefer the dynamic target; fall back to static anchor if no row cached yet.
    SELECT current_target_pct INTO v_target
    FROM alpha_tier_targets
    WHERE symbol = v_row.symbol AND style = v_row.style AND tier = v_row.tier;

    IF v_target IS NULL THEN
      v_target := CASE v_row.tier
        WHEN 'extremely_confident' THEN 80.0
        WHEN 'very_confident' THEN 65.0
        ELSE 55.0
      END;
    END IF;

    -- Fire only when pair-scoped realized is more than 10pp below the target
    IF v_row.win_rate_pct < (v_target - 10) THEN
      INSERT INTO ccip_post_deploy_observations (
        observation_type, ccip_tag, severity, scope, symbol, style,
        summary, detail, sample_size
      )
      VALUES (
        'PAIR_TIER_CALIBRATION_DRIFT',
        'CCIP-2026-0501D',
        'calibration',
        'pair',
        v_row.symbol,
        v_row.style,
        format(
          'On %s / %s, tier %s realized %s%% over %s trades — target %s%%. I am over-claiming this tier on this pair. Downgrade by one step or cite a named structural offset that applies to %s specifically.',
          v_row.symbol, v_row.style, v_row.tier,
          round(v_row.win_rate_pct, 1), v_row.sample_size, round(v_target, 1), v_row.symbol
        ),
        jsonb_build_object(
          'symbol', v_row.symbol,
          'style', v_row.style,
          'tier', v_row.tier,
          'realized_pct', round(v_row.win_rate_pct, 2),
          'target_pct', round(v_target, 2),
          'sample_size', v_row.sample_size,
          'wins', v_row.wins
        ),
        v_row.sample_size
      );

      v_observations := v_observations + 1;

      v_entry := jsonb_build_object(
        'symbol', v_row.symbol,
        'style', v_row.style,
        'tier', v_row.tier,
        'realized_pct', round(v_row.win_rate_pct, 2),
        'target_pct', round(v_target, 2),
        'sample_size', v_row.sample_size
      );
      v_pair_summary := v_pair_summary || jsonb_build_array(v_entry);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'observations_created', v_observations,
    'pair_summary', v_pair_summary
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'run_per_pair_tier_watcher failed: %', SQLERRM;
  RETURN jsonb_build_object(
    'observations_created', 0,
    'pair_summary', '[]'::jsonb,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION run_per_pair_tier_watcher() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Wrap stage 11 + 12 into the existing scheduled watcher run
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
  v_run_id uuid;
BEGIN
  BEGIN
    v_base_result := run_alpha_reasoning_watchers();
  EXCEPTION WHEN OTHERS THEN
    v_base_result := jsonb_build_object('error', SQLERRM);
  END;

  BEGIN
    v_evidence_result := run_evidence_citation_watcher();
  EXCEPTION WHEN OTHERS THEN
    v_evidence_result := jsonb_build_object('error', SQLERRM);
  END;

  BEGIN
    v_per_pair_result := run_per_pair_tier_watcher();
  EXCEPTION WHEN OTHERS THEN
    v_per_pair_result := jsonb_build_object('error', SQLERRM);
  END;

  BEGIN
    v_targets_updated := recompute_alpha_tier_targets();
  EXCEPTION WHEN OTHERS THEN
    v_targets_updated := 0;
  END;

  INSERT INTO alpha_reasoning_watcher_runs (
    run_at,
    observations_created,
    no_trade_rate_pct,
    no_trade_sample,
    vc_win_rate_pct,
    vc_sample,
    ec_win_rate_pct,
    ec_sample,
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
      + COALESCE((v_per_pair_result->>'observations_created')::int, 0),
    COALESCE((v_base_result->>'no_trade_rate_pct')::numeric, NULL),
    COALESCE((v_base_result->>'no_trade_sample')::int, NULL),
    COALESCE((v_base_result->>'vc_win_rate_pct')::numeric, NULL),
    COALESCE((v_base_result->>'vc_sample')::int, NULL),
    COALESCE((v_base_result->>'ec_win_rate_pct')::numeric, NULL),
    COALESCE((v_base_result->>'ec_sample')::int, NULL),
    COALESCE((v_base_result->>'counter_trend_violations')::int, NULL),
    COALESCE((v_per_pair_result->>'observations_created')::int, 0),
    COALESCE(v_per_pair_result->'pair_summary', '[]'::jsonb),
    COALESCE(v_targets_updated, 0),
    jsonb_build_object(
      'base', v_base_result,
      'evidence', v_evidence_result,
      'per_pair', v_per_pair_result,
      'tier_targets_updated', v_targets_updated
    )
  )
  RETURNING id INTO v_run_id;
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
  'ALPHA_BRAIN_UPGRADE_STAGE_11_12',
  'supabase/migrations/20260501_ccip_2026_0501d_stage11_12.sql',
  'run_per_pair_tier_watcher / recompute_alpha_tier_targets / get_current_tier_targets',
  'Stage 11 (per-pair × per-tier drift watchers) and Stage 12 (dynamic tier targets with shrinkage estimator). Observations are scope=pair and clamp ±15pp from static anchor. Zero execution gates added.',
  'CCIP-2026-0501D. Static tier anchors (65/80) remain the law in alpha-identity.ts; dynamic targets are a second mirror. User riskMode/riskPercent remains the SSOT for dollar exposure — tier labels do not change lot sizing.',
  2
);
