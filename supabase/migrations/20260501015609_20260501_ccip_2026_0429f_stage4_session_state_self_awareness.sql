/*
  # CCIP-2026-0429F — Stage 4 Session-State Self-Awareness

  Creates the get_recent_alpha_performance RPC used by the Alpha coordinator
  to inject a compact recent-performance summary into Alpha's system prompt.
  This is a REASONING INPUT, not a gate. It lets Alpha self-calibrate confidence
  against its own realized outcomes on the same instrument + style over the
  last N decisions.

  1. New Functions
    - `get_recent_alpha_performance(p_symbol text, p_style text, p_lookback int)`
      Returns aggregate stats over the most recent N completed decision outcomes
      for this symbol/style — win rate, avg pnl_pct, wins, losses, and the most
      recent outcome string (WIN | LOSS | BREAK_EVEN | UNKNOWN).

  2. Security
    - SECURITY DEFINER so it can read alpha_decision_outcomes without user-scope
      restrictions. The function only returns aggregate statistics (no row-level
      detail), so there is no PII leak.
    - Grants EXECUTE to authenticated and service_role.

  3. Governance
    - Pure advisory reasoning input. No gate, no block, no vote.
    - Consumed by coordinator-alpha.ts and rendered by alpha-identity.ts into
      a `recentPerformance` block inside the system prompt.
*/

CREATE OR REPLACE FUNCTION public.get_recent_alpha_performance(
  p_symbol text,
  p_style text,
  p_lookback int DEFAULT 10
)
RETURNS TABLE (
  sample_size int,
  wins int,
  losses int,
  break_evens int,
  win_rate numeric,
  avg_pnl_pct numeric,
  last_outcome text,
  last_outcome_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT
      ado.outcome,
      ado.pnl_pct,
      ado.completed_at
    FROM alpha_decision_outcomes ado
    JOIN alpha_decisions ad ON ad.id = ado.decision_id
    WHERE ad.symbol = p_symbol
      AND ad.trade_style = p_style
      AND ado.executed = true
      AND ado.outcome IS NOT NULL
      AND ado.completed_at IS NOT NULL
    ORDER BY ado.completed_at DESC
    LIMIT GREATEST(p_lookback, 1)
  )
  SELECT
    COUNT(*)::int AS sample_size,
    COUNT(*) FILTER (WHERE outcome = 'WIN')::int AS wins,
    COUNT(*) FILTER (WHERE outcome = 'LOSS')::int AS losses,
    COUNT(*) FILTER (WHERE outcome = 'BREAK_EVEN')::int AS break_evens,
    CASE
      WHEN COUNT(*) FILTER (WHERE outcome IN ('WIN','LOSS')) = 0 THEN 0::numeric
      ELSE ROUND(
        (COUNT(*) FILTER (WHERE outcome = 'WIN')::numeric
         / COUNT(*) FILTER (WHERE outcome IN ('WIN','LOSS'))::numeric) * 100,
        1
      )
    END AS win_rate,
    COALESCE(ROUND(AVG(pnl_pct)::numeric, 2), 0::numeric) AS avg_pnl_pct,
    (SELECT outcome FROM recent ORDER BY completed_at DESC LIMIT 1) AS last_outcome,
    (SELECT completed_at FROM recent ORDER BY completed_at DESC LIMIT 1) AS last_outcome_at
  FROM recent;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_alpha_performance(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_alpha_performance(text, text, int) TO service_role;

INSERT INTO ccip_alpha_prompt_deployments (
  change_type,
  affected_file,
  affected_function,
  change_description,
  governance_notes,
  fix_count
) VALUES (
  'ALPHA_BRAIN_UPGRADE_STAGE_4',
  'supabase/migrations/20260501_ccip_2026_0429f_stage4_session_state_self_awareness.sql',
  'get_recent_alpha_performance',
  'CCIP-2026-0429F Stage 4 — Session-State Self-Awareness. Creates get_recent_alpha_performance RPC returning win/loss/break-even counts, win rate, avg pnl %, and last outcome for the most recent N alpha decisions on a given symbol+style. Feeds a recentPerformance block in the system prompt so Alpha can self-calibrate confidence against its own realized outcomes.',
  'Pure advisory reasoning input. No gate, no block, no vote. SECURITY DEFINER with aggregate-only return shape — no PII leak. Paired with coordinator-alpha.ts fetch + alpha-identity.ts prompt block (same deployment wave).',
  1
);
