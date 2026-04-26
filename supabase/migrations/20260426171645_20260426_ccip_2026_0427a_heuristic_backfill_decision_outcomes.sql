/*
  # CCIP-2026-0427-A: Heuristic backfill — alpha_decisions <-> goal_session_trades

  ## Why

  The first-pass backfill found zero rows because no historical trade has
  goal_session_trades.alpha_decision_id populated. The link column was
  added in CCIP-2026-02-18 but the writer in alpha-trade-executor.ts only
  fires for new trades. Yet 778 alpha_decisions are marked trade_executed=true.

  This pass reconstructs the missing link via timestamp-nearest matching:
    - same user_id
    - same symbol
    - alpha_decisions.action (BUY/SELL) == goal_session_trades.direction (buy/sell)
    - trade opened within [-5min, +60min] of decision
    - prefer the closest trade by absolute timestamp difference
    - prefer the trade not already matched

  ## Authority

  This is a maintenance backfill only. The live link continues to be
  populated by alpha-trade-executor.ts going forward. This migration does
  NOT change any runtime path.

  ## Safety

  - Append-only insert into alpha_decision_outcomes
  - Pre-filter by NOT EXISTS to keep idempotent
  - Each goal_session_trade is matched to at most one decision (rn = 1
    on the trade side prevents many-to-one bleeding)
  - Logs row count via NOTICE
*/

DO $$
DECLARE
  inserted_count integer := 0;
BEGIN
  WITH paired AS (
    SELECT
      ad.id   AS decision_id,
      ad.user_id,
      gst.id  AS trade_id,
      gst.profit_loss,
      gst.entry_price,
      gst.exit_price,
      gst.direction,
      gst.opened_at,
      gst.closed_at,
      LOWER(COALESCE(gst.close_reason, '')) AS close_reason_lc,
      ROW_NUMBER() OVER (
        PARTITION BY ad.id
        ORDER BY ABS(EXTRACT(EPOCH FROM (gst.opened_at - ad.created_at)))
      ) AS rn_decision,
      ROW_NUMBER() OVER (
        PARTITION BY gst.id
        ORDER BY ABS(EXTRACT(EPOCH FROM (gst.opened_at - ad.created_at)))
      ) AS rn_trade
    FROM alpha_decisions ad
    JOIN goal_session_trades gst
      ON gst.user_id  = ad.user_id
      AND gst.symbol  = ad.symbol
      AND LOWER(ad.action) = gst.direction
      AND gst.status  = 'closed'
      AND gst.profit_loss IS NOT NULL
      AND gst.exit_price IS NOT NULL
      AND gst.opened_at BETWEEN ad.created_at - interval '5 minutes'
                            AND ad.created_at + interval '60 minutes'
    WHERE ad.trade_executed = true
      AND ad.action IN ('BUY','SELL')
      AND NOT EXISTS (
        SELECT 1 FROM alpha_decision_outcomes ado WHERE ado.decision_id = ad.id
      )
  )
  INSERT INTO alpha_decision_outcomes (
    decision_id, user_id, trade_id, executed, outcome,
    pnl, pnl_pct, duration_minutes, exit_reason, alpha_was_right, completed_at
  )
  SELECT
    p.decision_id,
    p.user_id,
    p.trade_id,
    true,
    CASE
      WHEN p.profit_loss >  0.005 THEN 'WIN'
      WHEN p.profit_loss < -0.005 THEN 'LOSS'
      ELSE 'BREAKEVEN'
    END,
    p.profit_loss,
    CASE
      WHEN p.entry_price IS NULL OR p.entry_price = 0 THEN NULL
      WHEN p.direction = 'buy'
        THEN ((p.exit_price - p.entry_price) / p.entry_price) * 100
      ELSE ((p.entry_price - p.exit_price) / p.entry_price) * 100
    END,
    CASE
      WHEN p.opened_at IS NULL OR p.closed_at IS NULL THEN NULL
      ELSE GREATEST(0, (EXTRACT(EPOCH FROM (p.closed_at - p.opened_at)) / 60)::integer)
    END,
    CASE
      WHEN p.close_reason_lc LIKE '%take_profit%' OR p.close_reason_lc = 'tp' THEN 'TP'
      WHEN p.close_reason_lc LIKE '%stop_loss%'   OR p.close_reason_lc = 'sl' THEN 'SL'
      WHEN p.close_reason_lc LIKE '%timeout%'
        OR p.close_reason_lc LIKE '%expired%'
        OR p.close_reason_lc LIKE '%session_end%' THEN 'TIMEOUT'
      ELSE 'MANUAL'
    END,
    (p.profit_loss > 0.005),
    COALESCE(p.closed_at, now())
  FROM paired p
  WHERE p.rn_decision = 1 AND p.rn_trade = 1;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'CCIP-2026-0427-A heuristic backfill: % rows inserted', inserted_count;
END $$;
