/*
  # CCIP-2026-0427I — Persist tp2_pnl to goal_session_trades

  ## Summary
  PositionsPage.tsx and TradeClosedActionDialog already render the TP1 leg + TP2
  leg + Total breakdown when both legs hit. The breakdown does not appear in the
  UI because goal_session_trades.tp2_pnl is NULL on every closed trade — it is
  written only to ai_trade_journal by post-trade-analyzer, never to the row the
  Closed Positions UI reads from.

  This migration:
  1. Backfills goal_session_trades.tp2_pnl for historical TP2-hit rows using the
     INCREMENTAL semantics defined in 2026-03-01 TP-MODAL-PNL-SSOT:
        tp2_pnl = profit_loss - COALESCE(tp1_pnl, 0)
  2. Installs a BEFORE UPDATE trigger that auto-computes tp2_pnl whenever a row
     transitions to a TP2 close (close_reason='take_profit_2' OR tp2_hit=true)
     so the column is always populated by the canonical closure path.

  ## Semantic Contract (re-stated for governance)
  - tp1_pnl: P&L from entry → tp1_price (entry leg) — written by
             position-monitoring-authority.ts when TP1 fires.
  - tp2_pnl: INCREMENTAL P&L from tp1_price → exit_price = profit_loss - tp1_pnl.
             Now maintained automatically by trigger on goal_session_trades.
  - profit_loss: Total entry → exit final P&L.

  ## Security
  - Trigger is BEFORE UPDATE only — it does not bypass RLS, it only fills in a
    derived numeric column on rows the caller is already authorized to update.
  - No new tables, no policy changes.
  - Backfill is idempotent (only touches rows where tp2_hit=true AND tp2_pnl IS NULL).
*/

-- 1. Backfill historical rows where TP2 hit but tp2_pnl was never written.
UPDATE goal_session_trades
SET tp2_pnl = ROUND((profit_loss - COALESCE(tp1_pnl, 0))::numeric, 4)
WHERE status = 'closed'
  AND tp2_hit = true
  AND tp2_pnl IS NULL
  AND profit_loss IS NOT NULL;

-- 2. Trigger function: auto-compute tp2_pnl on TP2 closure transitions.
CREATE OR REPLACE FUNCTION fn_compute_tp2_pnl_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act when the row is transitioning to or already at a TP2 close
  -- AND the caller has not already supplied tp2_pnl explicitly.
  IF (
    NEW.status = 'closed'
    AND (
      LOWER(COALESCE(NEW.close_reason, '')) = 'take_profit_2'
      OR NEW.tp2_hit = true
    )
    AND NEW.profit_loss IS NOT NULL
    AND NEW.tp2_pnl IS NULL
  ) THEN
    NEW.tp2_pnl := ROUND((NEW.profit_loss - COALESCE(NEW.tp1_pnl, 0))::numeric, 4);
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Attach the trigger (BEFORE UPDATE so the computed value is persisted with
--    the same UPDATE that closes the trade — no second write required).
DROP TRIGGER IF EXISTS trg_compute_tp2_pnl_on_close ON goal_session_trades;

CREATE TRIGGER trg_compute_tp2_pnl_on_close
  BEFORE UPDATE ON goal_session_trades
  FOR EACH ROW
  WHEN (NEW.status = 'closed')
  EXECUTE FUNCTION fn_compute_tp2_pnl_on_close();

-- 4. Governance comment for future readers.
COMMENT ON COLUMN goal_session_trades.tp2_pnl IS
  'SSOT (CCIP-2026-0427I): INCREMENTAL P&L from tp1_price to exit_price (= profit_loss - tp1_pnl). Auto-computed by trg_compute_tp2_pnl_on_close on TP2 closure. Mirrors ai_trade_journal.tp2_pnl semantics.';
