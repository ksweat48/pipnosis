/*
  # CCIP-2026-0501E — Stages 13 & 14: Winning-Pattern Reinforcement + Escalation

  ## Purpose
  Stage 13 surfaces symmetric reinforcement signals — not just "avoid this pattern"
  but also "this citation cluster is realized-winning on this pair." Stage 14
  escalates observations that fire repeatedly without Alpha self-correcting, so
  repeated drift gets stronger language and admin visibility.

  ## What This Migration Adds

  ### Stage 13 — Winning-Pattern Reinforcement Signal
  - New table `alpha_winning_pattern_signals` — per (symbol × style), stores top
    citation clusters by realized win rate with n >= 10.
  - New RPC `recompute_winning_patterns()` — daily aggregation of
    `alpha_reasoning_telemetry.ccip_citations` joined to outcomes.
  - New RPC `get_winning_patterns(p_symbol, p_style)` — coordinator-facing read.
  - Prompt language guards against hot-hand replay — Alpha reads the signal but
    still must judge structural fit.

  ### Stage 14 — Correction-Ignored Escalation
  - Adds `fire_count`, `first_seen_at`, `last_seen_at`, `escalation_level`
    columns to `ccip_post_deploy_observations`.
  - New trigger function `upsert_observation_by_fingerprint()` — when a
    watcher re-fires with the same (observation_type, ccip_tag, scope, symbol,
    style), increment fire_count instead of creating a duplicate row.
  - New RPC `recompute_observation_escalation()` — promotes advisory →
    elevated at fire_count >= 3, → urgent at fire_count >= 6 within 7 days.
  - Updated `get_active_reasoning_health()` to sort by escalation and expose
    escalation level + fire count.

  ## Safety
  - No existing watcher behavior changes. Stage 14 uses an UPSERT helper
    function; existing INSERT calls still work (new rows get fire_count=1).
  - Escalation only affects prose phrasing + admin display — no new code gate.
  - Stage 13 minimum sample size of 10 prevents over-fitting.
*/

-- ────────────────────────────────────────────────────────────────────────
-- Stage 13 — alpha_winning_pattern_signals
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_winning_pattern_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  style text NOT NULL,
  citation_cluster text[] NOT NULL,
  cluster_label text NOT NULL,
  sample_size integer NOT NULL,
  wins integer NOT NULL,
  win_rate_pct numeric(5,2) NOT NULL,
  avg_pnl_pct numeric(8,2),
  rank_within_pair integer NOT NULL,
  last_recomputed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alpha_winning_patterns_lookup
  ON alpha_winning_pattern_signals (symbol, style, rank_within_pair);

ALTER TABLE alpha_winning_pattern_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages winning patterns"
  ON alpha_winning_pattern_signals FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read winning patterns"
  ON alpha_winning_pattern_signals FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid() AND user_profiles.is_admin = true
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- Stage 13 — recompute top winning citation clusters
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_winning_patterns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  -- Clear the table; we rebuild fresh every run.
  DELETE FROM alpha_winning_pattern_signals
  WHERE last_recomputed_at < now() - interval '1 hour' OR true;

  -- Aggregate by normalized citation cluster (sorted first 3 citations).
  WITH decisions AS (
    SELECT
      ad.symbol,
      COALESCE(ad.trade_style, 'MICRO_INTRADAY') AS style,
      art.ccip_citations,
      ado.outcome,
      ado.pnl_pct
    FROM alpha_reasoning_telemetry art
    JOIN alpha_decisions ad ON ad.id = art.decision_id
    JOIN alpha_decision_outcomes ado ON ado.decision_id = ad.id
    WHERE art.created_at >= now() - interval '30 days'
      AND ad.symbol IS NOT NULL
      AND ado.outcome IN ('WIN', 'LOSS')
      AND ado.executed = true
      AND art.ccip_citations IS NOT NULL
      AND jsonb_array_length(art.ccip_citations) >= 2
  ),
  clusters AS (
    SELECT
      symbol,
      style,
      (
        SELECT array_agg(elem ORDER BY elem)
        FROM (
          SELECT DISTINCT jsonb_array_elements_text(ccip_citations) AS elem
          ORDER BY elem
          LIMIT 3
        ) s
      ) AS citation_cluster,
      outcome,
      pnl_pct
    FROM decisions
  ),
  aggregated AS (
    SELECT
      symbol,
      style,
      citation_cluster,
      COUNT(*)::int AS sample_size,
      SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END)::int AS wins,
      AVG(CASE WHEN outcome = 'WIN' THEN 100.0 ELSE 0 END)::numeric(5,2) AS win_rate_pct,
      AVG(pnl_pct)::numeric(8,2) AS avg_pnl_pct
    FROM clusters
    WHERE citation_cluster IS NOT NULL AND array_length(citation_cluster, 1) >= 2
    GROUP BY symbol, style, citation_cluster
    HAVING COUNT(*) >= 10 AND AVG(CASE WHEN outcome = 'WIN' THEN 100.0 ELSE 0 END) >= 55
  ),
  ranked AS (
    SELECT
      symbol, style, citation_cluster, sample_size, wins, win_rate_pct, avg_pnl_pct,
      ROW_NUMBER() OVER (PARTITION BY symbol, style ORDER BY win_rate_pct DESC, sample_size DESC) AS rank_within_pair
    FROM aggregated
  )
  INSERT INTO alpha_winning_pattern_signals (
    symbol, style, citation_cluster, cluster_label,
    sample_size, wins, win_rate_pct, avg_pnl_pct, rank_within_pair
  )
  SELECT
    symbol, style, citation_cluster,
    array_to_string(citation_cluster, ' + ') AS cluster_label,
    sample_size, wins, win_rate_pct, avg_pnl_pct, rank_within_pair
  FROM ranked
  WHERE rank_within_pair <= 3;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'recompute_winning_patterns failed: %', SQLERRM;
  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_winning_patterns() TO service_role;

CREATE OR REPLACE FUNCTION get_winning_patterns(
  p_symbol text,
  p_style text
)
RETURNS TABLE (
  cluster_label text,
  citation_cluster text[],
  sample_size integer,
  wins integer,
  win_rate_pct numeric,
  avg_pnl_pct numeric,
  rank_within_pair integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cluster_label, citation_cluster, sample_size, wins, win_rate_pct, avg_pnl_pct, rank_within_pair
  FROM alpha_winning_pattern_signals
  WHERE symbol = p_symbol AND style = p_style
  ORDER BY rank_within_pair ASC
  LIMIT 3;
$$;

GRANT EXECUTE ON FUNCTION get_winning_patterns(text, text) TO service_role, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 14 — escalation columns on observations
-- ────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ccip_post_deploy_observations' AND column_name = 'fire_count'
  ) THEN
    ALTER TABLE ccip_post_deploy_observations ADD COLUMN fire_count integer DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ccip_post_deploy_observations' AND column_name = 'first_seen_at'
  ) THEN
    ALTER TABLE ccip_post_deploy_observations ADD COLUMN first_seen_at timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ccip_post_deploy_observations' AND column_name = 'last_seen_at'
  ) THEN
    ALTER TABLE ccip_post_deploy_observations ADD COLUMN last_seen_at timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ccip_post_deploy_observations' AND column_name = 'escalation_level'
  ) THEN
    ALTER TABLE ccip_post_deploy_observations ADD COLUMN escalation_level text DEFAULT 'advisory';
  END IF;
END $$;

-- Backfill first_seen_at / last_seen_at from created_at where null
UPDATE ccip_post_deploy_observations
SET first_seen_at = COALESCE(first_seen_at, created_at),
    last_seen_at = COALESCE(last_seen_at, created_at)
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 14 — fingerprint-based UPSERT helper for watchers
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_ccip_observation(
  p_observation_type text,
  p_ccip_tag text,
  p_severity text,
  p_scope text,
  p_symbol text,
  p_style text,
  p_summary text,
  p_detail jsonb,
  p_sample_size integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- Look for an active, non-resolved observation with the same fingerprint
  -- within the last 7 days.
  SELECT id INTO v_existing_id
  FROM ccip_post_deploy_observations
  WHERE observation_type = p_observation_type
    AND ccip_tag = p_ccip_tag
    AND COALESCE(scope, 'global') = COALESCE(p_scope, 'global')
    AND COALESCE(symbol, '') = COALESCE(p_symbol, '')
    AND COALESCE(style, '') = COALESCE(p_style, '')
    AND resolved_at IS NULL
    AND created_at >= now() - interval '7 days'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE ccip_post_deploy_observations
    SET fire_count = COALESCE(fire_count, 1) + 1,
        last_seen_at = now(),
        expires_at = now() + interval '24 hours',
        summary = p_summary,
        detail = p_detail,
        sample_size = p_sample_size
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO ccip_post_deploy_observations (
    observation_type, ccip_tag, severity, scope, symbol, style,
    summary, detail, sample_size, fire_count, first_seen_at, last_seen_at
  )
  VALUES (
    p_observation_type, p_ccip_tag, p_severity, p_scope, p_symbol, p_style,
    p_summary, p_detail, p_sample_size, 1, now(), now()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_ccip_observation(text, text, text, text, text, text, text, jsonb, integer) TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 14 — escalation recompute
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_observation_escalation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE ccip_post_deploy_observations
  SET escalation_level = CASE
    WHEN COALESCE(fire_count, 1) >= 6 THEN 'urgent'
    WHEN COALESCE(fire_count, 1) >= 3 THEN 'elevated'
    ELSE 'advisory'
  END
  WHERE resolved_at IS NULL
    AND created_at >= now() - interval '7 days';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'recompute_observation_escalation failed: %', SQLERRM;
  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_observation_escalation() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 11/14 — upgrade get_active_reasoning_health to expose new fields
-- ────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_active_reasoning_health();

CREATE OR REPLACE FUNCTION get_active_reasoning_health(
  p_symbol text DEFAULT NULL,
  p_style text DEFAULT NULL
)
RETURNS TABLE (
  observation_type text,
  ccip_tag text,
  severity text,
  summary text,
  sample_size integer,
  created_at timestamptz,
  scope text,
  symbol text,
  style text,
  fire_count integer,
  escalation_level text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    observation_type,
    ccip_tag,
    severity,
    summary,
    sample_size,
    created_at,
    scope,
    symbol,
    style,
    COALESCE(fire_count, 1) AS fire_count,
    COALESCE(escalation_level, 'advisory') AS escalation_level
  FROM ccip_post_deploy_observations
  WHERE resolved_at IS NULL
    AND expires_at > now()
    AND (
      scope = 'global'
      OR (p_symbol IS NOT NULL AND symbol = p_symbol AND (p_style IS NULL OR style IS NULL OR style = p_style))
    )
  ORDER BY
    CASE COALESCE(escalation_level, 'advisory')
      WHEN 'urgent' THEN 1
      WHEN 'elevated' THEN 2
      ELSE 3
    END,
    created_at DESC
  LIMIT 8;
$$;

GRANT EXECUTE ON FUNCTION get_active_reasoning_health(text, text) TO service_role, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Stage 14 — rewire watchers to use upsert_ccip_observation
-- ────────────────────────────────────────────────────────────────────────

-- Replace direct INSERTs in run_per_pair_tier_watcher with the fingerprint upsert
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

    IF v_row.win_rate_pct < (v_target - 10) THEN
      PERFORM upsert_ccip_observation(
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
  RETURN jsonb_build_object('observations_created', 0, 'pair_summary', '[]'::jsonb, 'error', SQLERRM);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- Wrap stage 13 + 14 into scheduled run
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

  BEGIN
    v_patterns_updated := recompute_winning_patterns();
  EXCEPTION WHEN OTHERS THEN
    v_patterns_updated := 0;
  END;

  BEGIN
    v_escalations_updated := recompute_observation_escalation();
  EXCEPTION WHEN OTHERS THEN
    v_escalations_updated := 0;
  END;

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
      'tier_targets_updated', v_targets_updated,
      'winning_patterns_updated', v_patterns_updated,
      'escalations_updated', v_escalations_updated
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
  'ALPHA_BRAIN_UPGRADE_STAGE_13_14',
  'supabase/migrations/20260501_ccip_2026_0501e_stage13_14.sql',
  'recompute_winning_patterns / get_winning_patterns / upsert_ccip_observation / recompute_observation_escalation / get_active_reasoning_health(p_symbol, p_style)',
  'Stage 13 adds symmetric winning-pattern reinforcement signals (top citation clusters by realized win rate, n>=10). Stage 14 adds fire_count/escalation_level on observations — repeated drift escalates advisory→elevated→urgent — and exposes filtering by symbol×style on get_active_reasoning_health.',
  'CCIP-2026-0501E. No execution gates added. All new signals are prose-only in the prompt. Hot-hand guard language shipped in alpha-identity.ts alongside.',
  2
);
