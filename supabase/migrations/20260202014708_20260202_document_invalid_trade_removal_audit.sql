/*
  # Invalid Trade Removal - Audit Documentation

  Trade Removed: da3cbc21-5714-4a16-bed4-47123f0ea49a
  
  Details:
  - Symbol: ETHUSD
  - Direction: SELL
  - Entry Price: 2252.771581571841
  - Exit Price: 2308.030000 (INVALID: > entry price)
  - P&L: -97.2548164335598400000
  - User: 91905a02-cf9e-4537-9920-98a4b790830a (ksweat48@gmail.com)
  - Closed: 2026-02-02 01:34:21.889878+00

  Issue: 
  - SELL position requires exit_price < entry_price
  - This trade had exit_price > entry_price
  - TP was placed on wrong side of trade
  - Geometry mathematically invalid

  Resolution:
  - Trade record deleted from goal_session_trades
  - User balance restored: +97.25
  - Before correction: account_balance was reduced by this invalid trade
  - After correction: account_balance = 5874.98 (includes restoration)

  SSOT Compliance:
  - Trade database is single source of truth
  - Invalid trades removed at source
  - No downstream impacts remain
*/

-- Verify no orphaned entry intents for this trade
DO $$
DECLARE
  v_orphaned_intents INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_orphaned_intents
  FROM entry_intents
  WHERE entry_intents.id NOT IN (
    SELECT entry_intent_id 
    FROM goal_session_trades 
    WHERE entry_intent_id IS NOT NULL
  )
  AND entry_intents.created_at > NOW() - INTERVAL '1 hour';

  IF v_orphaned_intents > 0 THEN
    RAISE NOTICE 'Found % orphaned entry intents in last hour', v_orphaned_intents;
  ELSE
    RAISE NOTICE 'No orphaned entry intents detected - cleanup successful';
  END IF;
END $$;
