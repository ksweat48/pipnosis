/*
  # Fix Admin Dashboard SSOT Violations - Part 1: Data Cleanup

  ## Step 1: Clean up invalid lot_size values before adding constraints
*/

-- Identify and fix trades with unreasonable lot_size values
DO $$
DECLARE
  v_trade record;
  v_fixed_count integer := 0;
BEGIN
  FOR v_trade IN
    SELECT id, symbol, lot_size, position_size
    FROM goal_session_trades
    WHERE lot_size IS NOT NULL
      AND (
        lot_size <= 0 OR
        (UPPER(symbol) IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') AND lot_size > 100.0) OR
        ((UPPER(symbol) LIKE 'BTC%' OR UPPER(symbol) LIKE 'ETH%') AND lot_size > 1.0) OR
        (UPPER(symbol) NOT IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30')
         AND UPPER(symbol) NOT LIKE 'BTC%' 
         AND UPPER(symbol) NOT LIKE 'ETH%' 
         AND lot_size > 10.0)
      )
  LOOP
    -- Fix the lot_size to a reasonable default
    UPDATE goal_session_trades
    SET lot_size = CASE
      WHEN UPPER(v_trade.symbol) IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN 1.0
      WHEN UPPER(v_trade.symbol) LIKE 'BTC%' OR UPPER(v_trade.symbol) LIKE 'ETH%' THEN 0.001
      ELSE 0.01
    END
    WHERE id = v_trade.id;
    
    v_fixed_count := v_fixed_count + 1;
    
    RAISE NOTICE '[Data Cleanup] Fixed lot_size for trade % (symbol: %, old: %, new: %)',
      v_trade.id, v_trade.symbol, v_trade.lot_size,
      CASE
        WHEN UPPER(v_trade.symbol) IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN 1.0
        WHEN UPPER(v_trade.symbol) LIKE 'BTC%' OR UPPER(v_trade.symbol) LIKE 'ETH%' THEN 0.001
        ELSE 0.01
      END;
  END LOOP;

  RAISE NOTICE '[Data Cleanup] Fixed % trades with invalid lot_size values', v_fixed_count;
END $$;

-- Backfill lot_size from position_size where lot_size is NULL
DO $$
DECLARE
  v_updated_count integer;
BEGIN
  UPDATE goal_session_trades
  SET lot_size = position_size
  WHERE lot_size IS NULL
    AND position_size IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count > 0 THEN
    RAISE NOTICE '[SSOT Fix] Backfilled lot_size for % trades from position_size', v_updated_count;
  END IF;
END $$;
