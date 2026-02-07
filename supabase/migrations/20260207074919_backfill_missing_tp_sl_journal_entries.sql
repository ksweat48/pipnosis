/*
  # Backfill Missing TP/SL Journal Entries

  1. Problem
    - 38 trades closed via take_profit or stop_loss have no corresponding ai_trade_journal entry
    - Root cause: trade-closure-coordinator did not trigger post-trade analysis directly
    - Journal creation relied on fragile Realtime subscription to trade_closure_events

  2. Changes
    - Inserts retroactive journal entries for all closed TP/SL trades missing journal records
    - Only backfills trades with close_reason IN ('take_profit', 'stop_loss', 'take_profit_1', 'take_profit_2')
    - Sets actual_outcome, pnl, outcome fields based on trade data
    - Marks entries as retroactive backfill via llm_reasoning field

  3. Safety
    - Uses LEFT JOIN to only insert for trades that truly have no journal entry
    - Does NOT modify any existing journal entries
    - Does NOT modify any trade records
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
  pnl,
  outcome,
  actual_outcome,
  was_prediction_correct,
  llm_reasoning,
  journal_entry_type,
  created_at,
  updated_at
)
SELECT
  t.user_id,
  t.id,
  t.goal_session_id,
  t.symbol,
  t.direction,
  t.created_at,
  t.closed_at,
  t.entry_price,
  t.exit_price,
  t.stop_loss,
  t.take_profit,
  t.profit_loss,
  CASE
    WHEN t.profit_loss > 0 THEN 'win'
    WHEN t.profit_loss < 0 THEN 'loss'
    ELSE 'breakeven'
  END,
  CASE
    WHEN t.close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2') THEN 'Hit take profit target'
    WHEN t.close_reason = 'stop_loss' THEN 'Hit stop loss'
    ELSE 'Closed by system'
  END,
  CASE
    WHEN t.close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2') THEN true
    ELSE false
  END,
  '[Retroactive backfill] Journal entry created via migration — original real-time journal creation was missed due to trade_closure_events pipeline failure. Close reason: ' || t.close_reason,
  'trade',
  NOW(),
  NOW()
FROM goal_session_trades t
LEFT JOIN ai_trade_journal j ON j.trade_id = t.id
WHERE t.status = 'closed'
  AND t.close_reason IN ('take_profit', 'stop_loss', 'take_profit_1', 'take_profit_2')
  AND j.id IS NULL;
