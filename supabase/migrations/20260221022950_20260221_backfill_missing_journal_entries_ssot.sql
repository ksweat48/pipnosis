/*
  # Retroactive Journal Entry Backfill — SSOT Compliance Fix

  ## Summary
  Backfills ai_trade_journal entries for all closed trades that are missing one.

  ## Root Cause
  The process-trade-closures edge function was marking trade_closure_events as
  "succeeded" WITHOUT creating journal entries. The browser-side idempotency
  guard then skipped those events because last_processed_at was already set.
  Result: 78 trades with no journal record.

  ## What This Migration Does
  1. Creates ai_trade_journal entries for all closed goal_session_trades
     that have no corresponding journal record
  2. Uses all available trade data (entry_price, exit_price, stop_loss,
     take_profit, direction, tp1/tp2 flags, pnl, closed_at)
  3. Idempotent: uses INSERT ... ON CONFLICT DO NOTHING to prevent
     double-entries if run multiple times

  ## Tables Modified
  - ai_trade_journal: inserts missing entries for closed trades

  ## Security
  - No RLS changes required (migration uses service role context)
  - All inserts preserve existing user_id ownership

  ## CCIP Compliance
  - Registered as CCIP change: journal creation is SSOT requirement
  - Does not modify any existing journal entries
  - Does not alter trade records
*/

INSERT INTO ai_trade_journal (
  user_id,
  trade_id,
  session_id,
  symbol,
  direction,
  entry_time,
  exit_time,
  entry_price,
  exit_price,
  stop_loss,
  take_profit,
  llm_reasoning,
  market_read,
  expected_outcome,
  pattern_identified,
  conviction_level,
  rank_at_time,
  outcome,
  actual_outcome,
  journal_entry_type,
  journal_stage,
  pnl,
  tp1_pnl,
  tp1_exit_price,
  tp2_pnl,
  tp2_exit_price
)
SELECT
  gst.user_id,
  gst.id AS trade_id,
  gst.goal_session_id AS session_id,
  gst.symbol,
  gst.direction,
  gst.created_at AS entry_time,
  COALESCE(gst.closed_at, NOW()) AS exit_time,
  COALESCE(gst.entry_price, 0) AS entry_price,
  gst.exit_price,
  gst.stop_loss,
  gst.take_profit,
  -- Reconstruct a minimal llm_reasoning from available data
  (gst.direction || ' trade on ' || gst.symbol || '. Close reason: ' || COALESCE(gst.close_reason, 'unknown') || '.') AS llm_reasoning,
  -- market_read from entry price if available
  CASE
    WHEN gst.entry_price IS NOT NULL AND gst.entry_price > 0
    THEN 'Trade opened at ' || gst.entry_price::text || '.'
    ELSE 'Entry conditions were not captured at open time.'
  END AS market_read,
  -- expected_outcome from SL/TP levels
  CASE
    WHEN gst.take_profit IS NOT NULL AND gst.stop_loss IS NOT NULL
    THEN 'Expected TP at ' || gst.take_profit::text || ', SL at ' || gst.stop_loss::text || '.'
    ELSE 'Target levels not recorded.'
  END AS expected_outcome,
  'System Trade' AS pattern_identified,
  70 AS conviction_level,
  'System' AS rank_at_time,
  -- outcome from pnl
  CASE
    WHEN gst.profit_loss > 0 THEN 'win'
    WHEN gst.profit_loss < 0 THEN 'loss'
    ELSE 'breakeven'
  END AS outcome,
  -- actual_outcome human-readable narrative
  CASE
    WHEN gst.tp2_hit = TRUE OR gst.close_reason = 'take_profit_2'
      THEN 'TP2 hit — ' || CASE WHEN gst.profit_loss >= 0 THEN '+' ELSE '' END || '$' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text
    WHEN gst.tp1_hit = TRUE OR gst.close_reason = 'take_profit_1'
      THEN 'TP1 hit — ' || CASE WHEN gst.profit_loss >= 0 THEN '+' ELSE '' END || '$' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text
    WHEN gst.close_reason = 'take_profit'
      THEN 'Take profit hit — ' || CASE WHEN gst.profit_loss >= 0 THEN '+' ELSE '' END || '$' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text
    WHEN gst.close_reason = 'stop_loss'
      THEN 'Stop loss hit — $' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text
    WHEN gst.close_reason = 'goal_achieved'
      THEN 'Goal achieved — +$' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text
    WHEN COALESCE(gst.profit_loss, 0) > 0
      THEN 'Closed manually for a profit of +$' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text || ' (' || COALESCE(gst.close_reason, 'manual') || ')'
    WHEN COALESCE(gst.profit_loss, 0) < 0
      THEN 'Closed with a loss of -$' || ABS(COALESCE(gst.profit_loss, 0))::numeric(10,2)::text || ' (' || COALESCE(gst.close_reason, 'manual') || ')'
    ELSE 'Closed at breakeven (' || COALESCE(gst.close_reason, 'manual') || ')'
  END AS actual_outcome,
  'trade' AS journal_entry_type,
  -- journal_stage from close reason and TP flags
  CASE
    WHEN gst.tp2_hit = TRUE OR gst.close_reason = 'take_profit_2' THEN 'tp2_hit'
    WHEN gst.tp1_hit = TRUE OR gst.close_reason = 'take_profit_1' THEN 'tp1_hit'
    WHEN gst.close_reason = 'goal_achieved' THEN 'goal_achieved'
    ELSE 'final'
  END AS journal_stage,
  COALESCE(gst.profit_loss, 0) AS pnl,
  -- tp1 fields only when tp1 was the closure reason
  CASE WHEN gst.tp1_hit = TRUE OR gst.close_reason = 'take_profit_1' THEN gst.profit_loss ELSE NULL END AS tp1_pnl,
  CASE WHEN gst.tp1_hit = TRUE OR gst.close_reason = 'take_profit_1' THEN gst.exit_price ELSE NULL END AS tp1_exit_price,
  -- tp2 fields only when tp2 was the closure reason
  CASE WHEN gst.tp2_hit = TRUE OR gst.close_reason = 'take_profit_2' THEN gst.profit_loss ELSE NULL END AS tp2_pnl,
  CASE WHEN gst.tp2_hit = TRUE OR gst.close_reason = 'take_profit_2' THEN gst.exit_price ELSE NULL END AS tp2_exit_price
FROM goal_session_trades gst
WHERE
  gst.status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM ai_trade_journal atj WHERE atj.trade_id = gst.id
  )
ON CONFLICT (trade_id) DO NOTHING;

-- Log how many entries were backfilled for auditability
DO $$
DECLARE
  backfill_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfill_count
  FROM ai_trade_journal atj
  INNER JOIN goal_session_trades gst ON gst.id = atj.trade_id
  WHERE gst.status = 'closed'
    AND atj.pattern_identified = 'System Trade'
    AND atj.created_at >= NOW() - INTERVAL '5 minutes';

  RAISE NOTICE 'SSOT Backfill complete: % journal entries created for previously un-journaled trades', backfill_count;
END $$;
