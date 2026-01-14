/*
  ═══════════════════════════════════════════════════════════════════════════
  EMERGENCY P0 FIX: US30 and Indices 10,000x P&L Calculation Bug
  ═══════════════════════════════════════════════════════════════════════════

  ## Critical Bug
  Admin dashboard showing $231,988.89 for a trade that should be $23.19!
  
  User: ksweat48@gmail.com
  Trade: US30 SELL @ 49200.60 → 49190.00
  - Expected P&L: ~$21.20 (10.60 pips × $2/pip)
  - Actual P&L shown: $231,988.89 (10,000x too high!)

  ## Root Cause
  Migration 20260108200621 accidentally REMOVED indices from calculate_pip_distance()
  when fixing ETHUSD/XAGUSD:
  
  - calculate_dollar_per_pip(): ✅ Has US30 support (line 108)
  - calculate_pip_distance(): ❌ MISSING US30 support!
  
  Result: US30 uses forex pip size (0.0001) instead of index pip size (1.0)
  - 10.60 / 0.0001 = 106,000 pips (should be 10.60 pips)
  - 106,000 pips × $2/pip = $212,000 (should be $21.20)

  ## SSOT Violation
  Two functions that must stay in sync drifted apart:
  - calculate_dollar_per_pip: Has indices ✅
  - calculate_pip_distance: Missing indices ❌

  ## Fix
  Add back index support to calculate_pip_distance() with 1.0 pip value.
  Restore SSOT compliance between both calculation functions.

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Drop and recreate calculate_pip_distance with INDEX support restored
DROP FUNCTION IF EXISTS calculate_pip_distance(text, numeric, numeric) CASCADE;

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
  -- XAUUSD: "20 pip stop" = 20 price points (e.g., 2657 to 2677)
  -- XAGUSD: "20 pip stop" = 20 price points (e.g., 28.50 to 28.70)
  ELSIF v_sym IN ('XAUUSD', 'XAGUSD') THEN
    v_pip := 1.0;
  
  -- ✅ CRITICAL FIX: Indices use 1.0 pip value (1 pip = 1 index point)
  -- US30: "10 pip stop" = 10 price points (e.g., 49200 to 49210)
  -- NAS100: "10 pip stop" = 10 price points (e.g., 21500 to 21510)
  ELSIF v_sym IN ('US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'DJI30') THEN
    v_pip := 1.0;
  
  -- Bitcoin: $1 move = 1 pip (natural for large price movements)
  ELSIF v_sym IN ('BTCUSD', 'BTCUSDT') THEN
    v_pip := 1.0;
  
  -- Ethereum: $0.10 move = 1 pip (smaller price, finer granularity)
  ELSIF v_sym IN ('ETHUSD', 'ETHUSDT') THEN
    v_pip := 0.1;
  
  -- Standard forex: Quoted to 4-5 decimal places, pip = 0.0001
  ELSE
    v_pip := 0.0001;
  END IF;

  RETURN ABS(p_exit_price - p_entry_price) / v_pip;
END;
$$;

-- Update function comment to document the fix
COMMENT ON FUNCTION calculate_pip_distance IS
'SSOT for pip distance calculation. Uses reasoning pip values that match trader thinking.
- Indices (US30, NAS100, etc): 1.0 (1 pip = 1 index point) - RESTORED Jan 14, 2026
- XAUUSD/XAGUSD: 1.0 (1 pip = 1 price point)
- BTCUSD: 1.0 (1 pip = $1)
- ETHUSD: 0.1 (1 pip = $0.10)
- JPY pairs: 0.01 (1 pip = 0.01 yen)
- Standard forex: 0.0001 (1 pip = 0.0001 currency units)';

-- Grant permissions
GRANT EXECUTE ON FUNCTION calculate_pip_distance(text, numeric, numeric) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Validation & Testing
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  us30_pip_dist numeric;
  us30_dpp numeric;
  us30_pnl numeric;
  expected_pip_dist numeric := 10.60;
  expected_dpp numeric := 2.00;
  expected_pnl numeric := 21.20;
BEGIN
  -- Test US30 calculation
  us30_pip_dist := calculate_pip_distance('US30', 49200.60, 49190.00);
  us30_dpp := calculate_dollar_per_pip('US30', 0.02);
  us30_pnl := calculate_pnl_universal('US30', 'sell', 49200.60, 49190.00, 0.02);

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'US30 PIP CALCULATION FIX - VALIDATION REPORT';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Test Case: US30 SELL @ 49200.60 → 49190.00 (0.02 lot)';
  RAISE NOTICE '';
  RAISE NOTICE 'Pip Distance:';
  RAISE NOTICE '  Calculated: % pips', us30_pip_dist;
  RAISE NOTICE '  Expected:   % pips', expected_pip_dist;
  RAISE NOTICE '  Status:     %', CASE WHEN ABS(us30_pip_dist - expected_pip_dist) < 0.1 THEN '✅ PASS' ELSE '❌ FAIL' END;
  RAISE NOTICE '';
  RAISE NOTICE 'Dollar Per Pip:';
  RAISE NOTICE '  Calculated: $%', us30_dpp;
  RAISE NOTICE '  Expected:   $%', expected_dpp;
  RAISE NOTICE '  Status:     %', CASE WHEN ABS(us30_dpp - expected_dpp) < 0.01 THEN '✅ PASS' ELSE '❌ FAIL' END;
  RAISE NOTICE '';
  RAISE NOTICE 'Total P&L:';
  RAISE NOTICE '  Calculated: $%', us30_pnl;
  RAISE NOTICE '  Expected:   $%', expected_pnl;
  RAISE NOTICE '  Status:     %', CASE WHEN ABS(us30_pnl - expected_pnl) < 1.00 THEN '✅ PASS' ELSE '❌ FAIL' END;
  RAISE NOTICE '';
  
  IF ABS(us30_pnl - expected_pnl) < 1.00 THEN
    RAISE NOTICE '✅ US30 CALCULATION FIXED - SSOT RESTORED';
  ELSE
    RAISE EXCEPTION '❌ US30 calculation still incorrect! Manual investigation required.';
  END IF;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
