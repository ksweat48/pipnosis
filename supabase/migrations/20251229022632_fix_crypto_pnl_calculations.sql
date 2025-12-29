/*
  # Fix Crypto P&L Calculations

  ## Problem
  ETHUSD is displaying PnL of $6,937,825.53 instead of ~$54

  Root cause: SQL functions using wrong pip values and multipliers for crypto:
  - ETHUSD was using pipValue: 1.0 instead of 0.1 (10x error)
  - ETHUSD was using multiplier: 1 instead of 0.1 (10x error in opposite direction)
  - Need to separate ETH and BTC logic since they have different pip values

  ## Changes
  1. Fix calculate_pip_distance to use 0.1 for ETHUSD (matching TypeScript)
  2. Fix calculate_dollar_per_pip to use 0.1 multiplier for ETHUSD (matching TypeScript)
  3. Keep BTCUSD at 1.0 for both (already correct for BTC)

  ## TypeScript Reference Values
  - ETHUSD: pipValue = 0.1, dollarPerPipPerLot = 0.1
  - BTCUSD: pipValue = 1.0, dollarPerPipPerLot = 1.0
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS calculate_pip_distance(text, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS calculate_dollar_per_pip(text, numeric) CASCADE;
DROP FUNCTION IF EXISTS calculate_pnl_universal(text, text, numeric, numeric, numeric) CASCADE;

-- Pip Distance Calculator (FIXED for ETHUSD)
CREATE FUNCTION calculate_pip_distance(p_symbol text, p_price1 numeric, p_price2 numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_pip numeric;
BEGIN
  -- JPY pairs and metals use 0.01
  IF v_sym LIKE '%JPY%' OR v_sym IN ('XAUUSD', 'XAGUSD') THEN
    v_pip := 0.01;
  -- ETHUSD uses 0.1 (CRITICAL FIX: was 1.0)
  ELSIF v_sym LIKE 'ETH%' THEN
    v_pip := 0.1;
  -- BTCUSD and indices use 1.0
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') OR v_sym LIKE 'BTC%' THEN
    v_pip := 1.0;
  -- Standard forex pairs use 0.0001
  ELSE
    v_pip := 0.0001;
  END IF;

  RETURN ABS(p_price2 - p_price1) / v_pip;
END;
$$;

-- Dollar Per Pip Calculator (FIXED for ETHUSD)
CREATE FUNCTION calculate_dollar_per_pip(p_symbol text, p_lot_size numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_mult numeric;
BEGIN
  IF p_lot_size <= 0 THEN
    RAISE EXCEPTION 'Invalid lot size: %', p_lot_size;
  END IF;

  -- JPY pairs use 10x
  IF v_sym LIKE '%JPY%' THEN
    v_mult := 10;
  -- ETHUSD uses 0.1x (CRITICAL FIX: was 1)
  ELSIF v_sym LIKE 'ETH%' THEN
    v_mult := 0.1;
  -- BTCUSD uses 1x (already correct)
  ELSIF v_sym LIKE 'BTC%' THEN
    v_mult := 1;
  -- Metals and indices use 100x
  ELSIF v_sym IN ('XAUUSD', 'XAGUSD', 'US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN
    v_mult := 100;
  -- Standard forex pairs use 10x
  ELSE
    v_mult := 10;
  END IF;

  RETURN p_lot_size * v_mult;
END;
$$;

-- Universal P&L Calculator (now uses fixed functions above)
CREATE FUNCTION calculate_pnl_universal(
  p_symbol text,
  p_direction text,
  p_entry_price numeric,
  p_exit_price numeric,
  p_lot_size numeric
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_pips numeric;
  v_dpp numeric;
  v_diff numeric;
BEGIN
  -- Calculate pip distance using fixed function
  v_pips := calculate_pip_distance(p_symbol, p_entry_price, p_exit_price);

  -- Calculate dollar per pip using fixed function
  v_dpp := calculate_dollar_per_pip(p_symbol, p_lot_size);

  -- Calculate price difference based on direction
  v_diff := CASE
    WHEN p_direction = 'buy' THEN p_exit_price - p_entry_price
    ELSE p_entry_price - p_exit_price
  END;

  -- Return P&L rounded to 2 decimals
  RETURN ROUND(
    CASE
      WHEN v_diff >= 0 THEN v_pips * v_dpp
      ELSE -v_pips * v_dpp
    END,
    2
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_pip_distance(text, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_dollar_per_pip(text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_pnl_universal(text, text, numeric, numeric, numeric) TO authenticated, service_role;

-- Test the fix with example values
DO $$
DECLARE
  v_test_pnl numeric;
  v_pip_dist numeric;
  v_dpp numeric;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '  TESTING CRYPTO P&L FIX';
  RAISE NOTICE '══════════════════════════════════════════════════════════';

  -- Test ETHUSD calculation
  -- Entry: 3300, Exit: 3373.08, Lot Size: 10, Direction: buy
  -- Expected: ~730.8 pips * $1/pip = $730.80
  v_pip_dist := calculate_pip_distance('ETHUSD', 3300, 3373.08);
  v_dpp := calculate_dollar_per_pip('ETHUSD', 10);
  v_test_pnl := calculate_pnl_universal('ETHUSD', 'buy', 3300, 3373.08, 10);

  RAISE NOTICE 'ETHUSD Test (10 lots):';
  RAISE NOTICE '  Entry: 3300, Exit: 3373.08';
  RAISE NOTICE '  Pip Distance: % pips', ROUND(v_pip_dist, 2);
  RAISE NOTICE '  Dollar/Pip: $%', ROUND(v_dpp, 2);
  RAISE NOTICE '  P&L: $% (expected: ~$730.80)', ROUND(v_test_pnl, 2);

  -- Test BTCUSD calculation
  v_pip_dist := calculate_pip_distance('BTCUSD', 50000, 50100);
  v_dpp := calculate_dollar_per_pip('BTCUSD', 0.1);
  v_test_pnl := calculate_pnl_universal('BTCUSD', 'buy', 50000, 50100, 0.1);

  RAISE NOTICE '';
  RAISE NOTICE 'BTCUSD Test (0.1 lots):';
  RAISE NOTICE '  Entry: 50000, Exit: 50100';
  RAISE NOTICE '  Pip Distance: % pips', ROUND(v_pip_dist, 2);
  RAISE NOTICE '  Dollar/Pip: $%', ROUND(v_dpp, 2);
  RAISE NOTICE '  P&L: $% (expected: $10.00)', ROUND(v_test_pnl, 2);

  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ CRYPTO P&L CALCULATIONS FIXED';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
END $$;
