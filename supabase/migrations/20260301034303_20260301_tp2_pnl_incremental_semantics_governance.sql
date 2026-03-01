/*
  # TP1/TP2 P&L Semantics Governance Fix — CCIP TP-MODAL-PNL-SSOT (2026-03-01)

  ## Problem
  The tp2_pnl column in ai_trade_journal was being populated with the TOTAL final
  trade P&L (entry → TP2 exit) instead of the INCREMENTAL TP2 leg P&L (TP1 → TP2).
  This caused the TradeClosedActionDialog to show "$13.41" as the TP2 result when the
  actual total trade P&L was "$1341.34" — a 100x display error triggered by an
  incorrect "unrealistic P&L" auto-correction guard in the modal.

  ## Root Cause Chain
  1. post-trade-analyzer.ts stored tp2_pnl = tradeData.pnl (total, not incremental)
  2. trade-closure-coordinator.ts did not fetch tp1_pnl/tp2_pnl → modal got null values
  3. Modal fell back to profitLoss (raw trade P&L = correct total $1341.34)
  4. Modal's isUnrealisticPnL guard (>$1000 → divide by 100) fired → showed $13.41
  5. "Value auto-corrected from display error" warning appeared

  ## Changes in this migration
  - Documents the corrected semantic contract for tp1_pnl and tp2_pnl columns
  - Adds a comment to the ai_trade_journal table columns for governance clarity
  - No data is destroyed or altered (additive governance only)

  ## Semantic Contract (SSOT)
  - tp1_pnl: P&L the trade would have made from entry → TP1 price at full lot size
              (Written by post-trade-analyzer when close_reason = 'take_profit_1' or tp1_hit=true)
  - tp2_pnl: INCREMENTAL P&L from TP1 → TP2 exit price = (total_pnl - tp1_pnl)
              (Written by post-trade-analyzer when close_reason = 'take_profit_2')
  - profit_loss: Total final P&L from entry to exit (always the complete trade result)

  ## Code Changes (outside this migration)
  - post-trade-analyzer.ts: tp2_pnl = finalPnL - tp1Pnl (incremental)
  - trade-closure-coordinator.ts: now fetches tp1_pnl, tp2_pnl, tp1_hit from DB
  - TradeClosedActionDialog.tsx: removed incorrect auto-correction guard;
      TP2 modal headline now shows session P&L (currentProgress); trade legs shown as detail
  - GoalSessionDashboard.tsx: missed-event guard for TP1 modal on component mount
*/

DO $$
BEGIN
  COMMENT ON COLUMN ai_trade_journal.tp1_pnl IS
    'SSOT (2026-03-01): Incremental P&L from entry to TP1 price at full lot size. Written by post-trade-analyzer on take_profit_1 close.';

  COMMENT ON COLUMN ai_trade_journal.tp2_pnl IS
    'SSOT (2026-03-01): INCREMENTAL P&L from TP1 price to TP2 exit price (= total_pnl - tp1_pnl). NOT the total trade P&L. Written by post-trade-analyzer on take_profit_2 close.';
END $$;
