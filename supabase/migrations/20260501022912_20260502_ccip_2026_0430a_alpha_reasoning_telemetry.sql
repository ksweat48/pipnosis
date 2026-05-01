/*
  # CCIP-2026-0430A — Stage 6A Alpha Reasoning Telemetry & Closed Feedback Loop

  Makes the Stages 1-5 reasoning upgrades observable and self-correcting.
  No new execution gates — pure observability plus reasoning feedback into Alpha.

  1. New Tables
    - `alpha_reasoning_telemetry`
      One row per Alpha decision. Stores distilled reasoning signals:
      which CCIP blocks Alpha cited, counted evidence items, tier, entry_mode,
      Q5_failure_probability, final action. Used by watchers + future dashboard.

    - `ccip_post_deploy_observations`
      Drift-watcher observations. Each row is an active signal Alpha needs to
      see on future scans. Watchers INSERT when drift is detected; rows have
      an expires_at so stale observations stop polluting the prompt.

  2. New Functions
    - `record_alpha_reasoning_telemetry(...)`
      Coordinator calls this after Alpha returns. SECURITY DEFINER so it can
      write without user-scoped RLS pain. Non-blocking on failure.

    - `run_alpha_reasoning_watchers()`
      Single RPC that runs all drift detectors: (a) global NO_TRADE rate
      watcher (Alpha should solve — not refuse), (b) confidence_tier vs.
      realized-outcome calibration, (c) counter-trend triple-gate audit.
      Writes findings into ccip_post_deploy_observations.

    - `get_active_reasoning_health()`
      Returns only currently-firing observations for the prompt. Empty when
      Alpha's reasoning health is clean — keeps tokens lean.

  3. Security
    - Both tables RLS-enabled.
    - authenticated users can SELECT their own telemetry rows (scoped by user_id).
    - service_role retains full access for the coordinator + watcher.
    - Observations are platform-wide (no user_id) — readable by authenticated,
      writable only by service_role.

  4. Governance
    - CCIP-2026-0430A tag on all objects.
    - Telemetry write is non-blocking — failures never gate execution.
    - Watchers run out-of-band; the prompt only reads currently-active rows.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 1: alpha_reasoning_telemetry
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.alpha_reasoning_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid,
  user_id uuid,
  symbol text NOT NULL,
  style text NOT NULL,
  action text NOT NULL,
  entry_mode text,
  confidence_tier text,
  q5_failure_probability numeric,
  named_evidence_count int DEFAULT 0,
  ccip_citations jsonb DEFAULT '[]'::jsonb,
  contradiction_reconciliations jsonb DEFAULT '[]'::jsonb,
  answer_sheet_coherence_score numeric,
  reasoning_length int,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_art_symbol_style_created
  ON public.alpha_reasoning_telemetry(symbol, style, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_art_user_created
  ON public.alpha_reasoning_telemetry(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_art_tier_action_created
  ON public.alpha_reasoning_telemetry(confidence_tier, action, created_at DESC);

ALTER TABLE public.alpha_reasoning_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "art_user_select_own" ON public.alpha_reasoning_telemetry;
CREATE POLICY "art_user_select_own"
  ON public.alpha_reasoning_telemetry FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE 2: ccip_post_deploy_observations
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ccip_post_deploy_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type text NOT NULL,
  ccip_tag text,
  severity text DEFAULT 'advisory',
  scope text DEFAULT 'global',
  symbol text,
  style text,
  summary text NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb,
  sample_size int,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours'),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cpo_active_created
  ON public.ccip_post_deploy_observations(expires_at DESC, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cpo_type_scope
  ON public.ccip_post_deploy_observations(observation_type, scope);

ALTER TABLE public.ccip_post_deploy_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cpo_authenticated_select" ON public.ccip_post_deploy_observations;
CREATE POLICY "cpo_authenticated_select"
  ON public.ccip_post_deploy_observations FOR SELECT
  TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: record_alpha_reasoning_telemetry
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_alpha_reasoning_telemetry(
  p_decision_id uuid,
  p_user_id uuid,
  p_symbol text,
  p_style text,
  p_action text,
  p_entry_mode text,
  p_confidence_tier text,
  p_q5_failure_probability numeric,
  p_named_evidence_count int,
  p_ccip_citations jsonb,
  p_contradiction_reconciliations jsonb,
  p_answer_sheet_coherence_score numeric,
  p_reasoning_length int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO alpha_reasoning_telemetry (
    decision_id, user_id, symbol, style, action, entry_mode, confidence_tier,
    q5_failure_probability, named_evidence_count, ccip_citations,
    contradiction_reconciliations, answer_sheet_coherence_score, reasoning_length
  ) VALUES (
    p_decision_id, p_user_id, p_symbol, p_style, p_action, p_entry_mode, p_confidence_tier,
    p_q5_failure_probability, COALESCE(p_named_evidence_count, 0),
    COALESCE(p_ccip_citations, '[]'::jsonb),
    COALESCE(p_contradiction_reconciliations, '[]'::jsonb),
    p_answer_sheet_coherence_score, p_reasoning_length
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_alpha_reasoning_telemetry(
  uuid, uuid, text, text, text, text, text, numeric, int, jsonb, jsonb, numeric, int
) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: run_alpha_reasoning_watchers
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_alpha_reasoning_watchers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_no_trade_rate numeric;
  v_no_trade_sample int;
  v_vc_win_rate numeric;
  v_vc_sample int;
  v_ec_win_rate numeric;
  v_ec_sample int;
  v_counter_trend_violations int;
  v_created int := 0;
BEGIN
  -- Resolve any expired observations
  UPDATE ccip_post_deploy_observations
  SET resolved_at = now()
  WHERE resolved_at IS NULL
    AND expires_at < now();

  -- WATCHER 1: Global NO_TRADE rate. Alpha should solve, not refuse.
  -- Any non-trivial NO_TRADE share means Stage 1 Wait-First Law is regressing.
  SELECT
    ROUND(100.0 * COUNT(*) FILTER (WHERE action = 'NO_TRADE') / NULLIF(COUNT(*), 0), 1),
    COUNT(*)
  INTO v_no_trade_rate, v_no_trade_sample
  FROM alpha_decisions
  WHERE created_at >= now() - interval '24 hours'
    AND decision_origin NOT IN ('SYSTEM_PAIR_NOT_READY', 'SYSTEM_DATA_INTEGRITY')
    AND action IN ('BUY','SELL','NO_TRADE');

  IF v_no_trade_sample >= 20 AND v_no_trade_rate > 10 THEN
    INSERT INTO ccip_post_deploy_observations (
      observation_type, ccip_tag, severity, scope, summary, detail, sample_size
    ) VALUES (
      'NO_TRADE_RATE_EXCEEDED', 'CCIP-2026-0428E', 'reasoning', 'global',
      format('Global NO_TRADE rate %s%% over last %s decisions (target: near 0). Alpha is refusing instead of solving. Re-read CCIP-2026-0428E Wait-First Law: every scan has a direction. NO_TRADE is reserved for math-negative after reconciliation.', v_no_trade_rate, v_no_trade_sample),
      jsonb_build_object('no_trade_rate_pct', v_no_trade_rate, 'sample_size', v_no_trade_sample),
      v_no_trade_sample
    );
    v_created := v_created + 1;
  END IF;

  -- WATCHER 2a: very_confident tier calibration
  SELECT
    ROUND(100.0 * COUNT(*) FILTER (WHERE ado.outcome = 'WIN') /
          NULLIF(COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS')), 0), 1),
    COUNT(*)
  INTO v_vc_win_rate, v_vc_sample
  FROM alpha_decisions ad
  JOIN alpha_decision_outcomes ado ON ado.decision_id = ad.id
  WHERE ad.confidence_tier = 'very_confident'
    AND ado.executed = true
    AND ado.outcome IN ('WIN','LOSS')
    AND ado.completed_at >= now() - interval '14 days';

  IF v_vc_sample >= 20 AND v_vc_win_rate < 60 THEN
    INSERT INTO ccip_post_deploy_observations (
      observation_type, ccip_tag, severity, scope, summary, detail, sample_size
    ) VALUES (
      'TIER_CALIBRATION_DRIFT', 'CCIP-2026-0428F', 'calibration', 'global',
      format('very_confident tier realized %s%% win rate over last %s outcomes (rubric implies 65%%+). Tier is over-claimed. Downgrade discipline applies — require an additional named evidence citation before claiming very_confident.', v_vc_win_rate, v_vc_sample),
      jsonb_build_object('tier', 'very_confident', 'win_rate_pct', v_vc_win_rate, 'sample_size', v_vc_sample),
      v_vc_sample
    );
    v_created := v_created + 1;
  END IF;

  -- WATCHER 2b: extremely_confident tier calibration
  SELECT
    ROUND(100.0 * COUNT(*) FILTER (WHERE ado.outcome = 'WIN') /
          NULLIF(COUNT(*) FILTER (WHERE ado.outcome IN ('WIN','LOSS')), 0), 1),
    COUNT(*)
  INTO v_ec_win_rate, v_ec_sample
  FROM alpha_decisions ad
  JOIN alpha_decision_outcomes ado ON ado.decision_id = ad.id
  WHERE ad.confidence_tier = 'extremely_confident'
    AND ado.executed = true
    AND ado.outcome IN ('WIN','LOSS')
    AND ado.completed_at >= now() - interval '14 days';

  IF v_ec_sample >= 10 AND v_ec_win_rate < 75 THEN
    INSERT INTO ccip_post_deploy_observations (
      observation_type, ccip_tag, severity, scope, summary, detail, sample_size
    ) VALUES (
      'TIER_CALIBRATION_DRIFT', 'CCIP-2026-0428F', 'calibration', 'global',
      format('extremely_confident tier realized %s%% win rate over last %s outcomes (rubric implies 80%%+). Tier is over-claimed. This tier must be reserved for multi-dimensional structural agreement with fired triggers. Re-anchor to CCIP-2026-0428F Evidence Rubric.', v_ec_win_rate, v_ec_sample),
      jsonb_build_object('tier', 'extremely_confident', 'win_rate_pct', v_ec_win_rate, 'sample_size', v_ec_sample),
      v_ec_sample
    );
    v_created := v_created + 1;
  END IF;

  -- WATCHER 3: counter-trend execute_now without triple-gate citations
  -- CCIP-2026-0429B requires sweep-reclaim + trapped fuel + control-TF BOS.
  -- Audit: counter-trend execute_now decisions whose reasoning does not cite all three.
  SELECT COUNT(*)
  INTO v_counter_trend_violations
  FROM alpha_decisions
  WHERE created_at >= now() - interval '7 days'
    AND alpha_entry_mode = 'execute_now'
    AND action IN ('BUY','SELL')
    AND (
      (action = 'BUY' AND lower(htf_pattern) ~ 'down|bear')
      OR (action = 'SELL' AND lower(htf_pattern) ~ 'up|bull')
    )
    AND NOT (
      lower(COALESCE(reasoning,'')) LIKE '%sweep%reclaim%'
      AND (lower(COALESCE(reasoning,'')) LIKE '%trapped%' OR lower(COALESCE(reasoning,'')) LIKE '%q_trapped_fuel%')
      AND lower(COALESCE(reasoning,'')) LIKE '%bos%'
    );

  IF v_counter_trend_violations >= 3 THEN
    INSERT INTO ccip_post_deploy_observations (
      observation_type, ccip_tag, severity, scope, summary, detail, sample_size
    ) VALUES (
      'COUNTER_TREND_GATE_VIOLATION', 'CCIP-2026-0429B', 'reasoning', 'global',
      format('%s counter-trend execute_now decisions in last 7 days did not cite all three required gates (sweep-reclaim + trapped fuel + control-TF BOS). Re-anchor to CCIP-2026-0429B Counter-Trend Triple-Gate: without all three, drop to wait_pullback or switch to trend-aligned candidate.', v_counter_trend_violations),
      jsonb_build_object('violation_count', v_counter_trend_violations),
      v_counter_trend_violations
    );
    v_created := v_created + 1;
  END IF;

  RETURN jsonb_build_object(
    'observations_created', v_created,
    'no_trade_rate_pct', v_no_trade_rate,
    'no_trade_sample', v_no_trade_sample,
    'vc_win_rate_pct', v_vc_win_rate,
    'vc_sample', v_vc_sample,
    'ec_win_rate_pct', v_ec_win_rate,
    'ec_sample', v_ec_sample,
    'counter_trend_violations', v_counter_trend_violations,
    'run_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_alpha_reasoning_watchers() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: get_active_reasoning_health
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_active_reasoning_health()
RETURNS TABLE (
  observation_type text,
  ccip_tag text,
  severity text,
  summary text,
  sample_size int,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT observation_type, ccip_tag, severity, summary, sample_size, created_at
  FROM ccip_post_deploy_observations
  WHERE resolved_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_reasoning_health() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Deployment log
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ccip_alpha_prompt_deployments (
  change_type,
  affected_file,
  affected_function,
  change_description,
  governance_notes,
  fix_count
) VALUES (
  'ALPHA_BRAIN_UPGRADE_STAGE_6A',
  'supabase/migrations/20260502_ccip_2026_0430a_alpha_reasoning_telemetry.sql',
  'alpha_reasoning_telemetry + ccip_post_deploy_observations',
  'CCIP-2026-0430A Stage 6A — Reasoning Telemetry & Closed Feedback Loop. Adds alpha_reasoning_telemetry table (per-decision distilled signals), ccip_post_deploy_observations table (active drift-watcher signals), record_alpha_reasoning_telemetry RPC (non-blocking write from coordinator), run_alpha_reasoning_watchers RPC (global NO_TRADE rate watcher — Alpha should solve not refuse; very_confident and extremely_confident tier calibration vs realized outcomes; CCIP-2026-0429B counter-trend triple-gate audit), get_active_reasoning_health RPC (prompt reads only currently-firing observations — empty when clean, keeps tokens lean).',
  'Pure observability plus reasoning feedback. No new execution gates. Telemetry write non-blocking. Prompt block injected only when watchers have fired.',
  4
);
