/*
  # Fix Crypto and Silver Pip Calculations

  ## Problem
  Following comprehensive audit, found additional pip calculation issues:
  1. ETHUSD treated as BTCUSD (1.0 instead of 0.1 pip value)
  2. XAGUSD treated as XAUUSD (100 instead of 5.0 dollar per pip)

  ## Root Cause
  - Database functions didn't handle ETHUSD separately from BTCUSD
  - Database functions didn't handle XAGUSD separately from XAUUSD

  ## Changes
  1. Fix calculate_pip_distance() to use 0.1 for ETHUSD
  2. Fix calculate_dollar_per_pip() to use 5.0 for XAGUSD
  3. Add comments explaining all crypto and metal calculations

  ## Impact
  - ETHUSD: Pip distances will be correctly calculated (was 10x too small)
  - XAGUSD: Dollar per pip will be correctly calculated (was 20x too large)
*/

-- Step 1: Fix calculate_pip_distance to handle ETHUSD separately
DROP FUNCTION IF EXISTS calculate_pip_distance(text, numeric, numeric);

CREATE FUNCTION calculate_pip_distance(
  p_symbol text,
  p_entry_price numeric,
  p_exit_price numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sym text := UPPER(TRIM(p_symbol));
  v_pip numeric;
BEGIN
  -- CRITICAL: Each asset class uses reasoning pip values (TypeScript standard)
  -- These match trader thinking and LLM reasoning patterns

  -- JPY pairs: Quoted to 2 decimal places, pip = 0.01
  IF v_sym LIKE '%JPY%' THEN
    v_pip := 0.01;
  
  -- Precious Metals: Use 1.0 for natural reasoning
  -- XAUUSD: "20 pip stop" = 20 price points (e.g., 4357 to 4377)
  -- XAGUSD: "20 pip stop" = 20 price points (e.g., 28.50 to 28.70)
  ELSIF v_sym IN ('XAUUSD', 'XAGUSD') THEN
    v_pip := 1.0;
  
  -- Bitcoin: $1 move = 1 pip (natural for large price movements)
  ELSIF v_sym IN ('BTCUSD', 'BTCUSDT') THEN
    v_pip := 1.0;
  
  -- Ethereum: $0.10 move = 1 pip (smaller price, finer granularity)
  -- CRITICAL FIX: ETHUSD uses 0.1, NOT 1.0 like Bitcoin
  ELSIF v_sym IN ('ETHUSD', 'ETHUSDT') THEN
    v_pip := 0.1;
  
  -- Standard forex: Quoted to 4-5 decimal places, pip = 0.0001
  ELSE
    v_pip := 0.0001;
  END IF;

  RETURN ABS(p_exit_price - p_entry_price) / v_pip;
END;
$$;

-- Step 2: Fix calculate_dollar_per_pip to handle XAGUSD separately
DROP FUNCTION IF EXISTS calculate_dollar_per_pip(text, numeric);

CREATE FUNCTION calculate_dollar_per_pip(
  p_symbol text,
  p_lot_size numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sym text := UPPER(p_symbol);
  v_mult numeric;
BEGIN
  IF p_lot_size <= 0 THEN RAISE EXCEPTION 'Invalid lot size'; END IF;

  -- CRITICAL: Dollar per pip values match industry standards
  -- These are multiplied by lot size to get position's dollar per pip

  -- Ethereum: $0.10 per pip per 1.0 lot (smaller multiplier due to 0.1 pip value)
  IF v_sym = 'ETHUSD' OR v_sym LIKE 'ETH/%' THEN
    v_mult := 0.1;
  
  -- JPY pairs: $10 per pip per 1.0 lot (standard forex)
  ELSIF v_sym LIKE '%JPY%' THEN
    v_mult := 10;
  
  -- Gold: $100 per pip per 1.0 lot (100 oz contract)
  ELSIF v_sym = 'XAUUSD' THEN
    v_mult := 100;
  
  -- Silver: $5 per pip per 1.0 lot (5000 oz contract)
  -- CRITICAL FIX: XAGUSD uses 5.0, NOT 100 like Gold
  ELSIF v_sym = 'XAGUSD' THEN
    v_mult := 5;
  
  -- Indices: $100 per pip per 1.0 lot (CFD standard)
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN
    v_mult := 100;
  
  -- Bitcoin: $1 per pip per 1.0 lot (1 BTC contract)
  ELSIF v_sym LIKE 'BTC%' OR v_sym = 'BTCUSD' THEN
    v_mult := 1;
  
  -- Standard forex: $10 per pip per 1.0 lot (100k currency units)
  ELSE
    v_mult := 10;
  END IF;

  RETURN p_lot_size * v_mult;
END;
$$;

-- Step 3: Add comments to functions
COMMENT ON FUNCTION calculate_pip_distance IS
'SSOT for pip distance calculation. Uses reasoning pip values that match trader thinking.
- XAUUSD/XAGUSD: 1.0 (1 pip = 1 price point)
- BTCUSD: 1.0 (1 pip = $1)
- ETHUSD: 0.1 (1 pip = $0.10) - FIXED Jan 8, 2026
- JPY pairs: 0.01 (1 pip = 0.01 yen)
- Standard forex: 0.0001 (1 pip = 0.0001 currency units)';

COMMENT ON FUNCTION calculate_dollar_per_pip IS
'SSOT for dollar per pip calculation. Returns dollar value per pip for given lot size.
- XAUUSD: $100 per lot (100 oz contract)
- XAGUSD: $5 per lot (5000 oz contract) - FIXED Jan 8, 2026
- BTCUSD: $1 per lot
- ETHUSD: $0.10 per lot
- Indices: $100 per lot
- JPY pairs: $10 per lot
- Standard forex: $10 per lot';
