/*
  # CCIP-2026-0427-A: Backfill alpha_decision_outcomes from historical executed trades

  One-time backfill so the profitability dashboard has signal from day one.
  Source: goal_session_trades closed rows that have alpha_decision_id and profit_loss.
  Idempotency comes from the NOT EXISTS pre-check (no unique constraint on decision_id).
*/

DO $$
DECLARE
  inserted_count integer := 0;
BEGIN
  WITH closed_trades AS (
    SELECT
      gst.id                AS trade_id,
      gst.alpha_decision_id AS decision_id,
      gst.user_id,
      gst.profit_loss       AS pnl,
      gst.entry_price,
      gst.exit_price,
      gst.direction,
      gst.opened_at,
      gst.closed_at,
      LOWER(COALESCE(gst.close_reason, '')) AS close_reason_lc
    FROM goal_session_trades gst
    WHERE gst.status = 'closed'
      AND gst.alpha_decision_id IS NOT NULL
      AND gst.profit_loss IS NOT NULL
      AND gst.exit_price IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM alpha_decision_outcomes ado
        WHERE ado.decision_id = gst.alpha_decision_id
      )
  )
  INSERT INTO alpha_decision_outcomes (
    decision_id,
    user_id,
    trade_id,
    executed,
    outcome,
    pnl,
    pnl_pct,
    duration_minutes,
    exit_reason,
    alpha_was_right,
    completed_at
  )
  SELECT
    ct.decision_id,
    ct.user_id,
    ct.trade_id,
    true,
    CASE
      WHEN ct.pnl >  0.005 THEN 'WIN'
      WHEN ct.pnl < -0.005 THEN 'LOSS'
      ELSE 'BREAKEVEN'
    END,
    ct.pnl,
    CASE
      WHEN ct.entry_price IS NULL OR ct.entry_price = 0 THEN NULL
      WHEN ct.direction = 'buy'
        THEN ((ct.exit_price - ct.entry_price) / ct.entry_price) * 100
      ELSE ((ct.entry_price - ct.exit_price) / ct.entry_price) * 100
    END,
    CASE
      WHEN ct.opened_at IS NULL OR ct.closed_at IS NULL THEN NULL
      ELSE GREATEST(0, (EXTRACT(EPOCH FROM (ct.closed_at - ct.opened_at)) / 60)::integer)
    END,
    CASE
      WHEN ct.close_reason_lc LIKE '%take_profit%' OR ct.close_reason_lc = 'tp' THEN 'TP'
      WHEN ct.close_reason_lc LIKE '%stop_loss%'   OR ct.close_reason_lc = 'sl' THEN 'SL'
      WHEN ct.close_reason_lc LIKE '%timeout%'
        OR ct.close_reason_lc LIKE '%expired%'
        OR ct.close_reason_lc LIKE '%session_end%' THEN 'TIMEOUT'
      ELSE 'MANUAL'
    END,
    (ct.pnl > 0.005),
    COALESCE(ct.closed_at, now())
  FROM closed_trades ct;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'CCIP-2026-0427-A backfill: % rows inserted', inserted_count;
END $$;
