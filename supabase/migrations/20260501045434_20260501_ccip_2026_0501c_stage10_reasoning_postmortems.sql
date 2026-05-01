/*
  # CCIP-2026-0501C — Stage 10 Reasoning Post-Mortems

  Closes the feedback loop at the per-trade level. Each closed trade produces
  a post-mortem row correlating the reasoning artifacts (telemetry citations,
  evidence count, tier) with the realized outcome. Alpha sees the last 3
  post-mortems per symbol×style on every scan.

  Unlike the global watchers (Stage 6A, 9) which emit platform-wide drift
  signals, post-mortems are narrow and pair-specific: "on this symbol, in
  this style, with this tier, you won or lost — and here's what you cited."

  1. New Tables
    - `alpha_reasoning_postmortems`
      One row per completed decision. Captures symbol, style, action, tier,
      evidence count, top 3 citations, outcome (WIN/LOSS/BE/UNKNOWN),
      realized pnl_pct, and a short summary. Ordered by created_at so the
      prompt reads the newest 3 per pair×style.

  2. New Functions
    - `record_reasoning_postmortem(p_decision_id uuid)`
      Given a decision_id whose outcome has been recorded, composes the
      post-mortem from alpha_reasoning_telemetry + alpha_decision_outcomes.
      Idempotent — if a row already exists for the decision, updates it.
      SECURITY DEFINER for coordinator use.

    - `backfill_reasoning_postmortems(p_lookback_days int)`
      One-shot retro builder for existing outcomes. Non-blocking, safe to run
      repeatedly — uses ON CONFLICT DO UPDATE.

    - `get_recent_reasoning_postmortems(p_symbol text, p_style text, p_limit int)`
      Prompt-side reader. Returns up to N most-recent post-mortems for the
      pair×style. Used by coordinator-alpha to inject per-pair learning.

  3. Security
    - RLS enabled. authenticated users SELECT their own rows via user_id.
    - service_role retains full access.

  4. Governance
    - CCIP-2026-0501C on all objects.
    - Pure observability + prompt feedback. No execution gates.
    - Backfill runs automatically as part of this migration for last 14 days.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: alpha_reasoning_postmortems
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.alpha_reasoning_postmortems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid UNIQUE,
  user_id uuid,
  symbol text NOT NULL,
  style text NOT NULL,
  action text NOT NULL,
  entry_mode text,
  confidence_tier text,
  named_evidence_count int DEFAULT 0,
  top_citations jsonb DEFAULT '[]'::jsonb,
  outcome text,
  pnl_pct numeric,
  summary text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arp_symbol_style_created
  ON public.alpha_reasoning_postmortems(symbol, style, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arp_user_created
  ON public.alpha_reasoning_postmortems(user_id, created_at DESC);

ALTER TABLE public.alpha_reasoning_postmortems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arp_user_select_own" ON public.alpha_reasoning_postmortems;
CREATE POLICY "arp_user_select_own"
  ON public.alpha_reasoning_postmortems FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: record_reasoning_postmortem
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_reasoning_postmortem(p_decision_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_telemetry record;
  v_outcome record;
  v_top_citations jsonb;
  v_summary text;
BEGIN
  SELECT
    art.decision_id, art.user_id, art.symbol, art.style, art.action,
    art.entry_mode, art.confidence_tier, art.named_evidence_count,
    art.ccip_citations
  INTO v_telemetry
  FROM alpha_reasoning_telemetry art
  WHERE art.decision_id = p_decision_id
  LIMIT 1;

  IF v_telemetry IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ado.outcome, ado.realized_pnl_pct
  INTO v_outcome
  FROM alpha_decision_outcomes ado
  WHERE ado.decision_id = p_decision_id
    AND ado.executed = true
  LIMIT 1;

  -- Keep at most the first 3 citations (most prominent in prompt)
  v_top_citations := CASE
    WHEN jsonb_typeof(v_telemetry.ccip_citations) = 'array'
      THEN (SELECT jsonb_agg(c) FROM (
        SELECT value c
        FROM jsonb_array_elements(v_telemetry.ccip_citations)
        LIMIT 3
      ) s)
    ELSE '[]'::jsonb
  END;

  v_summary := format('%s %s on %s/%s — tier %s, %s evidence, outcome %s%s',
    v_telemetry.action,
    COALESCE(v_telemetry.entry_mode, ''),
    v_telemetry.symbol,
    v_telemetry.style,
    COALESCE(v_telemetry.confidence_tier, 'n/a'),
    COALESCE(v_telemetry.named_evidence_count, 0),
    COALESCE(v_outcome.outcome, 'UNKNOWN'),
    CASE
      WHEN v_outcome.realized_pnl_pct IS NOT NULL
        THEN format(' (%s%%)', ROUND(v_outcome.realized_pnl_pct::numeric, 2))
      ELSE ''
    END
  );

  INSERT INTO alpha_reasoning_postmortems (
    decision_id, user_id, symbol, style, action, entry_mode,
    confidence_tier, named_evidence_count, top_citations,
    outcome, pnl_pct, summary
  ) VALUES (
    p_decision_id, v_telemetry.user_id, v_telemetry.symbol, v_telemetry.style,
    v_telemetry.action, v_telemetry.entry_mode, v_telemetry.confidence_tier,
    COALESCE(v_telemetry.named_evidence_count, 0), COALESCE(v_top_citations, '[]'::jsonb),
    COALESCE(v_outcome.outcome, 'UNKNOWN'),
    v_outcome.realized_pnl_pct,
    v_summary
  )
  ON CONFLICT (decision_id) DO UPDATE SET
    outcome = EXCLUDED.outcome,
    pnl_pct = EXCLUDED.pnl_pct,
    summary = EXCLUDED.summary
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_reasoning_postmortem(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: backfill_reasoning_postmortems
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.backfill_reasoning_postmortems(p_lookback_days int DEFAULT 14)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT art.decision_id
    FROM alpha_reasoning_telemetry art
    JOIN alpha_decision_outcomes ado ON ado.decision_id = art.decision_id
    WHERE art.created_at >= now() - (p_lookback_days || ' days')::interval
      AND ado.executed = true
      AND art.decision_id IS NOT NULL
  LOOP
    PERFORM record_reasoning_postmortem(r.decision_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_reasoning_postmortems(int) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: get_recent_reasoning_postmortems
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_recent_reasoning_postmortems(
  p_symbol text,
  p_style text,
  p_limit int DEFAULT 3
)
RETURNS TABLE (
  confidence_tier text,
  action text,
  entry_mode text,
  named_evidence_count int,
  top_citations jsonb,
  outcome text,
  pnl_pct numeric,
  summary text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT confidence_tier, action, entry_mode, named_evidence_count,
         top_citations, outcome, pnl_pct, summary, created_at
  FROM alpha_reasoning_postmortems
  WHERE symbol = p_symbol
    AND style = p_style
    AND outcome IN ('WIN','LOSS','BREAKEVEN','BE')
  ORDER BY created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_reasoning_postmortems(text, text, int) TO authenticated, service_role;

-- Initial backfill (14-day window) — non-blocking
DO $$
DECLARE
  v_count int;
BEGIN
  BEGIN
    v_count := backfill_reasoning_postmortems(14);
    RAISE NOTICE 'Stage 10 backfill: % postmortems created/updated', v_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Stage 10 backfill skipped: %', SQLERRM;
  END;
END $$;

-- Deployment log
INSERT INTO ccip_alpha_prompt_deployments (
  change_type, affected_file, affected_function,
  change_description, governance_notes, fix_count
) VALUES (
  'ALPHA_BRAIN_UPGRADE_STAGE_10',
  'supabase/migrations/20260501_ccip_2026_0501c_stage10_reasoning_postmortems.sql',
  'alpha_reasoning_postmortems + record_reasoning_postmortem + backfill_reasoning_postmortems + get_recent_reasoning_postmortems',
  'CCIP-2026-0501C Stage 10 — Per-trade reasoning post-mortems. Each completed decision produces an alpha_reasoning_postmortems row correlating the reasoning artifacts (tier, evidence count, top 3 CCIP citations) with realized outcome and PnL%. record_reasoning_postmortem composes the row idempotently (ON CONFLICT DO UPDATE) from telemetry + outcomes. backfill_reasoning_postmortems seeds history for existing outcomes. get_recent_reasoning_postmortems returns the last 3 per symbol x style for injection into Alpha''s prompt via huntContextForPrompt so Alpha sees per-pair learning on every scan.',
  'Pure observability plus prompt feedback. No execution gates. Coordinator call is non-blocking — a missing postmortem never prevents a trade or blocks execution.',
  3
);
