/*
  # Fix ETHUSD Pip Calculation Regression

  CRITICAL FIX: The universal PnL calculator accidentally regressed the ETHUSD fix.
  ETHUSD must use 0.1 pip value and 0.1 multiplier, NOT 1.0.

  This migration corrects the calculate_pip_distance() and calculate_dollar_per_pip() 
  functions to properly handle ETHUSD separately from BTCUSD.

  ## Changes
  1. Split crypto handling to treat ETHUSD separately from BTCUSD
  2. ETHUSD: pipValue = 0.1, multiplier = 0.1
  3. BTCUSD: pipValue = 1.0, multiplier = 1.0
*/

-- Fix calculate_pip_distance to handle ETHUSD separately
CREATE OR REPLACE FUNCTION calculate_pip_distance(p_symbol text, p_price1 numeric, p_price2 numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_pip numeric;
BEGIN
  -- ETHUSD uses 0.1 as pip value
  IF v_sym = 'ETHUSD' OR v_sym LIKE 'ETH/%' THEN
    v_pip := 0.1;
  -- JPY pairs and precious metals use 0.01
  ELSIF v_sym LIKE '%JPY%' OR v_sym IN ('XAUUSD', 'XAGUSD') THEN
    v_pip := 0.01;
  -- BTCUSD and indices use 1.0
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') OR v_sym LIKE 'BTC%' OR v_sym = 'BTCUSD' THEN
    v_pip := 1.0;
  -- Standard forex pairs use 0.0001
  ELSE
    v_pip := 0.0001;
  END IF;
  RETURN ABS(p_price2 - p_price1) / v_pip;
END;
$$;

-- Fix calculate_dollar_per_pip to handle ETHUSD separately
CREATE OR REPLACE FUNCTION calculate_dollar_per_pip(p_symbol text, p_lot_size numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_mult numeric;
BEGIN
  IF p_lot_size <= 0 THEN RAISE EXCEPTION 'Invalid lot size'; END IF;
  
  -- ETHUSD uses 0.1 multiplier
  IF v_sym = 'ETHUSD' OR v_sym LIKE 'ETH/%' THEN
    v_mult := 0.1;
  -- JPY pairs use 10x multiplier (NOT 100x!)
  ELSIF v_sym LIKE '%JPY%' THEN
    v_mult := 10;
  -- Precious metals and indices use 100x multiplier
  ELSIF v_sym IN ('XAUUSD', 'XAGUSD', 'US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN
    v_mult := 100;
  -- BTCUSD uses 1x multiplier
  ELSIF v_sym LIKE 'BTC%' OR v_sym = 'BTCUSD' THEN
    v_mult := 1;
  -- Standard forex pairs use 10x multiplier
  ELSE
    v_mult := 10;
  END IF;
  RETURN p_lot_size * v_mult;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_pip_distance TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_dollar_per_pip TO authenticated, service_role;

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  ETHUSD PIP CALCULATION REGRESSION FIX COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ ETHUSD now correctly uses:';
  RAISE NOTICE '  - Pip Value: 0.1 (not 1.0)';
  RAISE NOTICE '  - Multiplier: 0.1 (not 1.0)';
  RAISE NOTICE '✓ BTCUSD remains:';
  RAISE NOTICE '  - Pip Value: 1.0';
  RAISE NOTICE '  - Multiplier: 1.0';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;