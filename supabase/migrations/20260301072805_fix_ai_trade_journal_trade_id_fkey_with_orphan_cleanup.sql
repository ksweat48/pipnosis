/*
  # Fix ai_trade_journal.trade_id foreign key — orphan cleanup + FK constraint

  ## Problem
  - ai_trade_journal.trade_id has values that do not exist in goal_session_trades
  - PostgREST cannot resolve the join without a declared FK relationship
  - Direct FK addition fails due to orphaned rows

  ## Changes
  1. NULL out trade_id values that reference non-existent goal_session_trades rows
     (data-safe: journal narrative is not lost, only the trade linkage is cleared)
  2. Add FK constraint ai_trade_journal.trade_id -> goal_session_trades.id ON DELETE SET NULL

  ## SSOT Compliance
  - ai_trade_journal is SSOT for journal narrative
  - goal_session_trades is SSOT for trade execution context
  - This FK formalises the existing semantic relationship so PostgREST can join them

  ## Safety
  - Only trade_id is nulled — all other journal columns (reasoning, pnl, outcome) are preserved
  - ON DELETE SET NULL ensures future trade deletions don't orphan journal rows
*/

UPDATE ai_trade_journal
SET trade_id = NULL
WHERE trade_id IS NOT NULL
  AND trade_id NOT IN (SELECT id FROM goal_session_trades);

ALTER TABLE ai_trade_journal
  ADD CONSTRAINT ai_trade_journal_trade_id_fkey
  FOREIGN KEY (trade_id)
  REFERENCES goal_session_trades(id)
  ON DELETE SET NULL;
