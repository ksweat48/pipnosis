/*
  # Fix ETHUSD Pip Value SSOT Compliance

  ## Problem
  ETHUSD had conflicting pip values across the system:
  - currencyHelpers.ts: pipValue = 1.0 ✅ (CORRECT - reasoning pip)
  - symbol-registry.ts: pipValue = 0.1 ❌ (WRONG - outdated)
  - Database functions: pipValue = 0.1 ❌ (WRONG - outdated)

  This caused zone tolerance calculations to be inconsistent:
  - Frontend (entry monitor): 30 pips × 1.0 = 30.0 price units (0.86% of ETH price)
  - Database functions: 30 pips × 0.1 = 3.0 price units (0.09% of ETH price)

  ## Solution
  Update database functions to use 1.0 for ETHUSD (matching currencyHelpers.ts)
  This aligns with BTCUSD behavior (both major cryptos use 1.0)

  ## SSOT Principle
  currencyHelpers.ts is the SINGLE SOURCE OF TRUTH for position sizing pip values.
  All other systems must match.

  ## Changes
  1. Fix calculate_pip_distance() to use 1.0 for ETHUSD
  2. Fix calculate_dollar_per_pip() to use 1.0 for ETHUSD
  3. Update all PnL and risk calculation functions

  ## Validation
  After this fix:
  - ETHUSD: pipValue = 1.0, dollarPerPipPerLot = 1.0 (everywhere)
  - Entry monitor zone tolerance: 30 pips × 1.0 = 30.0 price units ✅
  - Database PnL calculations: consistent with frontend ✅
*/

-- Step 1: Fix calculate_pip_distance to use 1.0 for ETHUSD
DROP FUNCTION IF EXISTS calculate_pip_distance(text, numeric, numeric) CASCADE;

CREATE FUNCTION calculate_pip_distance(
  p_symbol text,
  p_price1 numeric,
  p_price2 numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sym text := UPPER(TRIM(p_symbol));
  v_pip numeric;
BEGIN
  -- ETHUSD: Use 1.0 (SSOT: matches currencyHelpers.ts)
  -- Changed from 0.1 to align with BTCUSD and provide reasonable zone tolerances
  IF v_sym = 'ETHUSD' OR v_sym = 'ETH/USD' THEN
    v_pip := 1.0;

  -- JPY pairs use 0.01
  ELSIF v_sym LIKE '%JPY%' THEN
    v_pip := 0.01;

  -- Gold and Silver use specific pip values
  ELSIF v_sym = 'XAUUSD' OR v_sym = 'XAU/USD' OR v_sym = 'GOLD' THEN
    v_pip := 1.0;  -- Gold uses 1.0 point = 1 pip for natural reasoning
  ELSIF v_sym = 'XAGUSD' OR v_sym = 'XAG/USD' OR v_sym = 'SILVER' THEN
    v_pip := 1.0;  -- Silver uses 1.0 point = 1 pip

  -- Indices use 1.0
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN
    v_pip := 1.0;

  -- BTCUSD and other crypto use 1.0
  ELSIF v_sym = 'BTCUSD' OR v_sym = 'BTC/USD' OR v_sym LIKE 'BTC%' THEN
    v_pip := 1.0;

  -- Standard forex pairs use 0.0001
  ELSE
    v_pip := 0.0001;
  END IF;

  -- Calculate pip distance
  RETURN ABS(p_price1 - p_price2) / v_pip;
END;
$$;

-- Step 2: Fix calculate_dollar_per_pip to use 1.0 for ETHUSD
DROP FUNCTION IF EXISTS calculate_dollar_per_pip(text, numeric) CASCADE;

CREATE FUNCTION calculate_dollar_per_pip(
  p_symbol text,
  p_position_size numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sym text := UPPER(TRIM(p_symbol));
  v_dollar_per_pip_per_lot numeric;
BEGIN
  -- ETHUSD: Use 1.0 (SSOT: matches currencyHelpers.ts)
  IF v_sym = 'ETHUSD' OR v_sym = 'ETH/USD' THEN
    v_dollar_per_pip_per_lot := 1.0;

  -- BTCUSD: 1.0
  ELSIF v_sym = 'BTCUSD' OR v_sym = 'BTC/USD' OR v_sym LIKE 'BTC%' THEN
    v_dollar_per_pip_per_lot := 1.0;

  -- Gold: 100 per lot
  ELSIF v_sym = 'XAUUSD' OR v_sym = 'XAU/USD' OR v_sym = 'GOLD' THEN
    v_dollar_per_pip_per_lot := 100.0;

  -- Silver: 5 per lot
  ELSIF v_sym = 'XAGUSD' OR v_sym = 'XAG/USD' OR v_sym = 'SILVER' THEN
    v_dollar_per_pip_per_lot := 5.0;

  -- Indices: 100 per lot
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN
    v_dollar_per_pip_per_lot := 100.0;

  -- Standard forex: 10 per lot
  ELSE
    v_dollar_per_pip_per_lot := 10.0;
  END IF;

  RETURN p_position_size * v_dollar_per_pip_per_lot;
END;
$$;

-- Step 3: Recreate calculate_pnl_universal with updated functions
DROP FUNCTION IF EXISTS calculate_pnl_universal(text, text, numeric, numeric, numeric) CASCADE;

CREATE FUNCTION calculate_pnl_universal(
  p_symbol text,
  p_direction text,
  p_entry_price numeric,
  p_exit_price numeric,
  p_position_size numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_pnl numeric;
BEGIN
  -- Calculate pip distance (now uses 1.0 for ETHUSD)
  v_pip_distance := calculate_pip_distance(p_symbol, p_entry_price, p_exit_price);

  -- Calculate dollar per pip (now uses 1.0 for ETHUSD)
  v_dollar_per_pip := calculate_dollar_per_pip(p_symbol, p_position_size);

  -- Calculate P&L based on direction
  IF LOWER(p_direction) IN ('buy', 'long') THEN
    IF p_exit_price > p_entry_price THEN
      v_pnl := v_pip_distance * v_dollar_per_pip;
    ELSE
      v_pnl := -1 * v_pip_distance * v_dollar_per_pip;
    END IF;
  ELSIF LOWER(p_direction) IN ('sell', 'short') THEN
    IF p_exit_price < p_entry_price THEN
      v_pnl := v_pip_distance * v_dollar_per_pip;
    ELSE
      v_pnl := -1 * v_pip_distance * v_dollar_per_pip;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid direction: %. Must be buy/long or sell/short', p_direction;
  END IF;

  RETURN v_pnl;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION calculate_pip_distance TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION calculate_dollar_per_pip TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION calculate_pnl_universal TO authenticated, service_role, anon;

-- Validation test (comment out RAISE NOTICE in production)
DO $$
DECLARE
  v_pip_dist numeric;
  v_dpp numeric;
  v_pnl numeric;
BEGIN
  -- Test ETHUSD with 1.0 pip value
  v_pip_dist := calculate_pip_distance('ETHUSD', 3300.0, 3330.0);
  v_dpp := calculate_dollar_per_pip('ETHUSD', 10.0);
  v_pnl := calculate_pnl_universal('ETHUSD', 'buy', 3300.0, 3330.0, 10.0);

  RAISE NOTICE '=== ETHUSD SSOT Validation ===';
  RAISE NOTICE 'Entry: $3300, Exit: $3330, Position: 10 lots';
  RAISE NOTICE 'Pip Distance: % pips (expected: 30 pips with pipValue=1.0)', v_pip_dist;
  RAISE NOTICE 'Dollar/Pip: $% (expected: $10 = 10 lots × $1/pip)', v_dpp;
  RAISE NOTICE 'P&L: $% (expected: $300 = 30 pips × $10/pip)', v_pnl;

  IF v_pip_dist != 30.0 THEN
    RAISE WARNING 'ETHUSD pip distance incorrect! Expected 30, got %', v_pip_dist;
  END IF;

  IF v_dpp != 10.0 THEN
    RAISE WARNING 'ETHUSD dollar/pip incorrect! Expected 10, got %', v_dpp;
  END IF;

  IF v_pnl != 300.0 THEN
    RAISE WARNING 'ETHUSD P&L incorrect! Expected 300, got %', v_pnl;
  END IF;

  RAISE NOTICE '✅ ETHUSD SSOT validation complete';
END $$;
