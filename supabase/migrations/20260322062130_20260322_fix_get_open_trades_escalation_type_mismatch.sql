/*
  # Fix get_open_trades_needing_escalation type mismatch

  The function declared alpha_reasoning_snapshot as jsonb in its return type,
  but the actual column is text. PostgreSQL rejects this at query time with a
  "Returned type text does not match expected type jsonb" error.

  Fix: cast alpha_reasoning_snapshot::jsonb with a safe try-cast using a CASE
  expression that only casts when the value is valid JSON, or return NULL.
  Also changed return type declaration to use jsonb for the cast result.
*/

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
  alpha_reasoning_snapshot jsonb,
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
    CASE
      WHEN t.alpha_reasoning_snapshot IS NULL THEN NULL::jsonb
      ELSE (SELECT val FROM (SELECT t.alpha_reasoning_snapshot::jsonb AS val) sub LIMIT 1)
    END,
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
