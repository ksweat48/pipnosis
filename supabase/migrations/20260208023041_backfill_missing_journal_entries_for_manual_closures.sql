/*
  # Backfill Missing Journal Entries for Manual Closures

  ## Problem
  Trades closed manually (close_reason = 'manual') were not getting journal entries
  because the learning eligibility check in post-trade-analyzer was returning early
  BEFORE journal creation. This coupled user-facing journaling with AI learning,
  causing all non-learning-eligible trades to be silently excluded from the journal.

  ## What This Migration Does
  1. Identifies all closed trades in `goal_session_trades` that have NO corresponding
     entry in `ai_trade_journal`
  2. Creates retroactive journal entries for each missing trade using available trade data
  3. Marks these entries with appropriate outcome (win/loss/breakeven) and actual_outcome text

  ## Tables Modified
  - `ai_trade_journal` - INSERT new rows for trades missing journal entries

  ## Security
  - No RLS changes needed (existing policies cover authenticated user access)
  - Uses existing table structure, no schema changes

  ## CCIP Compliance
  - Root cause: architectural coupling between journal creation and learning eligibility
  - Fix: code change decouples these concerns (separate PR)
  - This migration: data remediation for historically affected trades
*/

INSERT INTO ai_trade_journal (
  user_id,
  trade_id,
  symbol,
  direction,
  entry_time,
  entry_price,
  exit_time,
  exit_price,
  stop_loss,
  take_profit,
  pnl,
  outcome,
  actual_outcome,
  llm_reasoning,
  market_read,
  expected_outcome,
  pattern_identified,
  conviction_level,
  rank_at_time,
  journal_entry_type
)
SELECT
  t.user_id,
  t.id AS trade_id,
  t.symbol,
  t.direction,
  t.created_at AS entry_time,
  t.entry_price,
  t.closed_at AS exit_time,
  t.exit_price,
  t.stop_loss,
  t.take_profit,
  t.profit_loss AS pnl,
  CASE
    WHEN t.profit_loss > 0 THEN 'win'
    WHEN t.profit_loss < 0 THEN 'loss'
    ELSE 'breakeven'
  END AS outcome,
  CASE
    WHEN t.profit_loss > 0 THEN
      'Trade closed (' || COALESCE(t.close_reason, 'unknown') || ') with profit of $' || ROUND(t.profit_loss::numeric, 2)::text
    WHEN t.profit_loss < 0 THEN
      'Trade closed (' || COALESCE(t.close_reason, 'unknown') || ') with loss of $' || ROUND(ABS(t.profit_loss::numeric), 2)::text
    ELSE
      'Trade closed (' || COALESCE(t.close_reason, 'unknown') || ') at breakeven'
  END AS actual_outcome,
  t.direction || ' trade on ' || t.symbol || '. Close reason: ' || COALESCE(t.close_reason, 'unknown') || '.' AS llm_reasoning,
  'Trade opened at ' || ROUND(t.entry_price::numeric, 5)::text || '.' AS market_read,
  CASE
    WHEN t.take_profit IS NOT NULL AND t.stop_loss IS NOT NULL THEN
      'Expected TP at ' || ROUND(t.take_profit::numeric, 5)::text || ', SL at ' || ROUND(t.stop_loss::numeric, 5)::text || '.'
    ELSE
      'Target levels not recorded.'
  END AS expected_outcome,
  'System Trade' AS pattern_identified,
  70 AS conviction_level,
  'System' AS rank_at_time,
  'trade' AS journal_entry_type
FROM goal_session_trades t
LEFT JOIN ai_trade_journal j ON j.trade_id = t.id
WHERE t.status = 'closed'
  AND j.id IS NULL
  AND t.exit_price IS NOT NULL
  AND t.closed_at IS NOT NULL;
