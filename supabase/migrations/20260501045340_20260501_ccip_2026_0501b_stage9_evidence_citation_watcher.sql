/*
  # CCIP-2026-0501B — Stage 9 Evidence-Citation Reinforcement Watcher

  Adds a fourth watcher: Evidence-Density Drift. Correlates named_evidence_count
  in alpha_reasoning_telemetry with realized outcomes. If low-evidence decisions
  (<3 citations) win materially less than high-evidence decisions (>=5), emits
  an EVIDENCE_DENSITY_DRIFT observation back into the prompt.

  This closes the loop on CCIP-2026-0428F (Evidence-Justified Confidence Rubric):
  Alpha must see whether its own evidence density is actually predicting outcomes.

  1. New Functions
    - `run_evidence_citation_watcher()`
      Computes win rates for low vs high evidence cohorts. Writes observation
      when gap >= 15 percentage points with n>=10 per cohort.

    - `run_and_log_alpha_reasoning_watchers()` (REPLACED)
      Now also calls run_evidence_citation_watcher(). Same void return as Stage 6B.
      Aggregate observations_created accounts for both watchers.

  2. Security
    - SECURITY DEFINER, service_role EXECUTE.

  3. Governance
    - CCIP-2026-0501B on all objects.
    - Pure observability. No new execution gates.
    - Non-blocking: watcher failures never affect trade execution.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: run_evidence_citation_watcher
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_evidence_citation_watcher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_low_win numeric;
  v_low_sample int;
  v_high_win numeric;
  v_high_sample int;
  v_gap numeric;
  v_created int := 0;
BEGIN
  -- Low evidence cohort: <3 named citations
  SELECT
    ROUND(100.0 * COUNT(*) FILTER (WHERE ado.outcome = 'WIN') /
          NULLIF(COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS')), 0), 1),
    COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS'))
  INTO v_low_win, v_low_sample
  FROM alpha_reasoning_telemetry art
  JOIN alpha_decision_outcomes ado ON ado.decision_id = art.decision_id
  WHERE art.created_at >= now() - interval '14 days'
    AND art.action IN ('BUY','SELL')
    AND ado.executed = true
    AND COALESCE(art.named_evidence_count, 0) < 3;

  -- High evidence cohort: >=5 named citations
  SELECT
    ROUND(100.0 * COUNT(*) FILTER (WHERE ado.outcome = 'WIN') /
          NULLIF(COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS')), 0), 1),
    COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS'))
  INTO v_high_win, v_high_sample
  FROM alpha_reasoning_telemetry art
  JOIN alpha_decision_outcomes ado ON ado.decision_id = art.decision_id
  WHERE art.created_at >= now() - interval '14 days'
    AND art.action IN ('BUY','SELL')
    AND ado.executed = true
    AND COALESCE(art.named_evidence_count, 0) >= 5;

  IF v_low_sample >= 10 AND v_high_sample >= 10 THEN
    v_gap := COALESCE(v_high_win, 0) - COALESCE(v_low_win, 0);
    IF v_gap >= 15 THEN
      INSERT INTO ccip_post_deploy_observations (
        observation_type, ccip_tag, severity, scope, summary, detail, sample_size
      ) VALUES (
        'EVIDENCE_DENSITY_DRIFT', 'CCIP-2026-0428F', 'reasoning', 'global',
        format('Evidence density is predictive: high-evidence decisions (>=5 citations) win %s%% vs low-evidence (<3) %s%% over last 14d (gap %s pp, n_high=%s, n_low=%s). Trust the rubric — when evidence is thin, downgrade tier or wait. Under-citing is costing win rate.',
               v_high_win, v_low_win, v_gap, v_high_sample, v_low_sample),
        jsonb_build_object(
          'high_evidence_win_rate', v_high_win,
          'low_evidence_win_rate', v_low_win,
          'gap_pp', v_gap,
          'high_sample', v_high_sample,
          'low_sample', v_low_sample
        ),
        v_high_sample + v_low_sample
      );
      v_created := v_created + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'observations_created', v_created,
    'low_evidence_win_rate', v_low_win,
    'low_evidence_sample', v_low_sample,
    'high_evidence_win_rate', v_high_win,
    'high_evidence_sample', v_high_sample,
    'gap_pp', v_gap
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_evidence_citation_watcher() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Replace wrapper to also invoke the evidence-citation watcher
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.run_and_log_alpha_reasoning_watchers();

CREATE OR REPLACE FUNCTION public.run_and_log_alpha_reasoning_watchers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_evidence jsonb;
  v_total_obs int := 0;
BEGIN
  BEGIN
    v_result := run_alpha_reasoning_watchers();
    v_total_obs := COALESCE((v_result->>'observations_created')::int, 0);

    BEGIN
      v_evidence := run_evidence_citation_watcher();
      v_total_obs := v_total_obs + COALESCE((v_evidence->>'observations_created')::int, 0);
    EXCEPTION WHEN OTHERS THEN
      v_evidence := jsonb_build_object('error', SQLERRM);
    END;

    INSERT INTO alpha_reasoning_watcher_runs (
      observations_created, no_trade_rate_pct, no_trade_sample,
      vc_win_rate_pct, vc_sample, ec_win_rate_pct, ec_sample,
      counter_trend_violations, raw_result
    ) VALUES (
      v_total_obs,
      NULLIF(v_result->>'no_trade_rate_pct','')::numeric,
      NULLIF(v_result->>'no_trade_sample','')::int,
      NULLIF(v_result->>'vc_win_rate_pct','')::numeric,
      NULLIF(v_result->>'vc_sample','')::int,
      NULLIF(v_result->>'ec_win_rate_pct','')::numeric,
      NULLIF(v_result->>'ec_sample','')::int,
      NULLIF(v_result->>'counter_trend_violations','')::int,
      jsonb_build_object('tier_watchers', v_result, 'evidence_watcher', v_evidence)
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO alpha_reasoning_watcher_runs (error_message, raw_result)
    VALUES (SQLERRM, jsonb_build_object('error', SQLERRM, 'state', SQLSTATE));
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_and_log_alpha_reasoning_watchers() TO service_role;

-- Deployment log
INSERT INTO ccip_alpha_prompt_deployments (
  change_type, affected_file, affected_function,
  change_description, governance_notes, fix_count
) VALUES (
  'ALPHA_BRAIN_UPGRADE_STAGE_9',
  'supabase/migrations/20260501_ccip_2026_0501b_stage9_evidence_citation_watcher.sql',
  'run_evidence_citation_watcher + run_and_log_alpha_reasoning_watchers',
  'CCIP-2026-0501B Stage 9 — Evidence-Citation Reinforcement Watcher. Correlates named_evidence_count in alpha_reasoning_telemetry with realized outcomes from alpha_decision_outcomes over a 14-day rolling window. When high-evidence (>=5 citations) cohort wins >=15 percentage points more than low-evidence (<3) cohort with n>=10 each side, emits EVIDENCE_DENSITY_DRIFT observation tied to CCIP-2026-0428F so Alpha sees the signal on next scan. Also rewires run_and_log_alpha_reasoning_watchers to invoke both tier watchers and the evidence watcher in one scheduled run.',
  'Pure observability. No new execution gates. Non-blocking — if the evidence watcher errors, tier watchers still run and log.',
  2
);
