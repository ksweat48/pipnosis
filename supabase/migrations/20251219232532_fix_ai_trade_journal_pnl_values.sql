/*
  # Fix AI Trade Journal P&L Values

  The ai_trade_journal table has outdated P&L values from before the fix.
  Sync it with the corrected values from goal_session_trades.
*/

-- Update all journal entries with corrected P&L from goal_session_trades
UPDATE ai_trade_journal atj
SET 
  pnl = gst.profit_loss,
  exit_price = gst.exit_price,
  exit_time = gst.closed_at,
  outcome = CASE 
    WHEN gst.profit_loss > 0 THEN 'win'
    WHEN gst.profit_loss < 0 THEN 'loss'
    ELSE 'breakeven'
  END,
  updated_at = now()
FROM goal_session_trades gst
WHERE atj.trade_id = gst.id
  AND gst.status = 'closed'
  AND gst.profit_loss IS NOT NULL
  AND atj.pnl != gst.profit_loss;

-- Log the results
DO $$
DECLARE
  v_updated_count integer;
BEGIN
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  AI TRADE JOURNAL P&L FIX COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ Updated % journal entries with correct P&L values', v_updated_count;
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

-- Create function to keep journal in sync with trades (for future)
CREATE OR REPLACE FUNCTION sync_journal_pnl_on_trade_close()
RETURNS TRIGGER AS $$
BEGIN
  -- When a trade is closed, update the journal with correct P&L
  IF NEW.status = 'closed' AND OLD.status != 'closed' THEN
    UPDATE ai_trade_journal
    SET 
      pnl = NEW.profit_loss,
      exit_price = NEW.exit_price,
      exit_time = NEW.closed_at,
      outcome = CASE 
        WHEN NEW.profit_loss > 0 THEN 'win'
        WHEN NEW.profit_loss < 0 THEN 'loss'
        ELSE 'breakeven'
      END,
      updated_at = now()
    WHERE trade_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-sync journal when trade closes
DROP TRIGGER IF EXISTS sync_journal_on_trade_close ON goal_session_trades;
CREATE TRIGGER sync_journal_on_trade_close
  AFTER UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION sync_journal_pnl_on_trade_close();

COMMENT ON FUNCTION sync_journal_pnl_on_trade_close() IS
  'Automatically syncs AI trade journal with correct P&L when trade closes';
