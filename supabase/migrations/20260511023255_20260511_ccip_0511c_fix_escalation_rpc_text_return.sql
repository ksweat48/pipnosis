/*
  # CCIP-2026-0511C — Fix get_open_trades_needing_escalation JSON cast crash

  ## Problem
  The RPC declared alpha_reasoning_snapshot as jsonb in its return type and
  cast the underlying text column with `t.alpha_reasoning_snapshot::jsonb`.
  The column stores human-readable prose (e.g. "BUY advocate claims: ...")
  which is NOT valid JSON, so PostgreSQL raised 22P02 ("Token \"BUY\" is
  invalid.") and the entire RPC returned HTTP 400. The mid-trade escalation
  engine was silently disabled whenever any open trade had a prose snapshot.

  The prior fix (20260322062130) wrapped the cast in a CASE + subquery but
  still evaluated `::jsonb` on non-NULL rows — the cast error was never
  actually suppressed.

  ## Fix (Option A — align contract with reality)
  Change the return column alpha_reasoning_snapshot from jsonb to text. The
  column IS text; pretending otherwise was the bug. Callers that want a
  parsed object can JSON.parse with their own try/catch.

  ## Security
  SECURITY DEFINER preserved. No RLS changes. No data mutation.
*/

DROP FUNCTION IF EXISTS public.get_open_trades_needing_escalation();

CREATE OR REPLACE FUNCTION public.get_open_trades_needing_escalation()
RETURNS TABLE(
  trade_id uuid,
  user_id uuid,
  goal_session_id uuid,
  symbol text,
  direction text,
  entry_price numeric,
  current_price numeric,
  stop_loss numeric,
  take_profit numeric,
  take_profit_1 numeric,
  lot_size numeric,
  opened_at timestamp with time zone,
  mid_trade_plan jsonb,
  alpha_reasoning_snapshot text,
  alpha_recheck_verdict jsonb,
  thesis_status text,
  last_alpha_recheck_at timestamp with time zone,
  alpha_recheck_count integer,
  tp1_hit boolean,
  tp1_breakeven_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.user_id,
    t.goal_session_id,
    t.symbol,
    t.direction,
    t.entry_price,
    COALESCE(t.current_price, t.entry_price),
    t.stop_loss,
    t.take_profit,
    t.take_profit_1,
    COALESCE(t.lot_size, t.position_size),
    t.opened_at,
    t.mid_trade_plan,
    t.alpha_reasoning_snapshot,
    t.alpha_recheck_verdict,
    COALESCE(t.thesis_status, 'new'),
    t.last_alpha_recheck_at,
    COALESCE(t.alpha_recheck_count, 0),
    COALESCE(t.tp1_hit, false),
    t.tp1_breakeven_price
  FROM goal_session_trades t
  WHERE t.status = 'open'
    AND t.entry_price IS NOT NULL
    AND t.stop_loss IS NOT NULL
    AND t.take_profit IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_trades_needing_escalation() TO authenticated, service_role;
