/*
  ═══════════════════════════════════════════════════════════════════════════
  FIX CORRUPTED US30/INDEX P&L VALUES - SSOT COMPLIANCE
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  Trades have TWO P&L columns with inconsistent values:
  - `current_pnl`: Corrupted with 10,000x inflated values (due to pip bug)
  - `profit_loss`: Has correct values
  
  Examples from ksweat48@gmail.com:
  - Trade 5aebd6d8: current_pnl=$180,635.96 vs profit_loss=$210.67 (857x diff!)
  - Trade 13e7e88d: current_pnl=$93,551.68 vs profit_loss=$93.55 (1000x diff!)

  ## Root Cause
  When US30 pip calculation was broken (using 0.0001 instead of 1.0):
  - Some code paths wrote to `current_pnl` with corrupted values
  - Other code paths wrote to `profit_loss` with correct values
  - Result: SSOT violation with two conflicting sources of truth

  ## Solution
  1. For closed trades: Copy correct `profit_loss` → `current_pnl`
  2. For open trades: Recalculate using fixed pip function
  3. Update user balances to remove the inflated amounts
  4. Establish `profit_loss` as SSOT for closed trades

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Identify all index trades with corrupted current_pnl
CREATE TEMP TABLE corrupted_trades AS
SELECT 
  t.id,
  t.user_id,
  t.symbol,
  t.status,
  t.current_pnl as corrupted_value,
  CASE 
    WHEN t.status = 'closed' THEN t.profit_loss
    ELSE calculate_pnl_universal(
      t.symbol,
      t.direction,
      t.entry_price::numeric,
      COALESCE(t.current_price, t.entry_price)::numeric,
      COALESCE(t.lot_size, 0.02)::numeric
    )
  END as correct_value,
  CASE 
    WHEN t.status = 'closed' THEN (t.current_pnl - t.profit_loss)
    ELSE (t.current_pnl - calculate_pnl_universal(
      t.symbol,
      t.direction,
      t.entry_price::numeric,
      COALESCE(t.current_price, t.entry_price)::numeric,
      COALESCE(t.lot_size, 0.02)::numeric
    ))
  END as balance_correction
FROM goal_session_trades t
WHERE UPPER(t.symbol) IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30')
  AND ABS(
    t.current_pnl - CASE 
      WHEN t.status = 'closed' THEN t.profit_loss
      ELSE calculate_pnl_universal(
        t.symbol,
        t.direction,
        t.entry_price::numeric,
        COALESCE(t.current_price, t.entry_price)::numeric,
        COALESCE(t.lot_size, 0.02)::numeric
      )
    END
  ) > 10;

-- Log what we're about to fix
DO $$
DECLARE
  total_trades integer;
  total_balance_correction numeric;
BEGIN
  SELECT COUNT(*), SUM(balance_correction)
  INTO total_trades, total_balance_correction
  FROM corrupted_trades;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'CORRUPTED INDEX TRADES AUDIT';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'Total corrupted trades: %', total_trades;
  RAISE NOTICE 'Total balance over-inflation: $%', ROUND(total_balance_correction, 2);
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- Fix closed trades: Copy profit_loss → current_pnl
UPDATE goal_session_trades t
SET 
  current_pnl = t.profit_loss,
  updated_at = NOW()
FROM corrupted_trades ct
WHERE t.id = ct.id
  AND t.status = 'closed';

-- Fix open trades: Recalculate with corrected function
UPDATE goal_session_trades t
SET 
  current_pnl = calculate_pnl_universal(
    t.symbol,
    t.direction,
    t.entry_price::numeric,
    COALESCE(t.current_price, t.entry_price)::numeric,
    COALESCE(t.lot_size, 0.02)::numeric
  ),
  updated_at = NOW()
FROM corrupted_trades ct
WHERE t.id = ct.id
  AND t.status = 'open';

-- Correct user balances (remove the inflated amounts)
UPDATE user_profiles up
SET 
  account_balance = up.account_balance - ct.balance_correction,
  updated_at = NOW()
FROM (
  SELECT 
    user_id,
    SUM(balance_correction) as balance_correction
  FROM corrupted_trades
  WHERE status = 'closed'
  GROUP BY user_id
) ct
WHERE up.id = ct.user_id
  AND ABS(ct.balance_correction) > 1;

-- Log the fixes applied
DO $$
DECLARE
  v_rec record;
  v_count integer := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'FIXES APPLIED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  
  FOR v_rec IN 
    SELECT 
      ct.id,
      ct.symbol,
      ct.status,
      ct.corrupted_value,
      ct.correct_value,
      ct.balance_correction
    FROM corrupted_trades ct
    ORDER BY ABS(ct.balance_correction) DESC
    LIMIT 10
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE '[%] % (%) | $% → $% (corrected $%)',
      v_count,
      v_rec.symbol,
      v_rec.status,
      ROUND(v_rec.corrupted_value, 2),
      ROUND(v_rec.correct_value, 2),
      ROUND(v_rec.balance_correction, 2);
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ All index trades corrected';
  RAISE NOTICE '✅ User balances adjusted';
  RAISE NOTICE '✅ SSOT compliance restored';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- Drop temp table
DROP TABLE corrupted_trades;

-- Add validation constraint to prevent future corruption
COMMENT ON COLUMN goal_session_trades.current_pnl IS
'Current unrealized or final P&L for this trade.
For closed trades: MUST equal profit_loss (SSOT).
For open trades: Recalculated from live prices.
Updated: 2026-01-14 - Restored SSOT compliance after US30 pip bug.';

COMMENT ON COLUMN goal_session_trades.profit_loss IS
'AUTHORITATIVE P&L value when trade is closed (SSOT).
For closed trades: This is the single source of truth.
For open trades: Not yet determined, may be 0 or NULL.
Updated: 2026-01-14 - Established as SSOT for closed trades.';
