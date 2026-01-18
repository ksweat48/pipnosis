/*
  # Fix Zone Tolerance Values - CRITICAL BUG FIX

  ## Problem
  Zone tolerance values in get_entry_time_thresholds() are 10-20x too high:
  - MICRO_INTRADAY Phase 2: 30 pips (should be 2 pips)
  - MICRO_INTRADAY Phase 3: 60 pips (should be 5 pips)
  
  This causes a 5-pip entry zone to expand to 65 pips, making execution impossible
  because the tolerance is so large it never actually checks properly.

  ## Fix
  Correct tolerance values to match intended design:
  - SCALP: 0 → 1 → 2 pips
  - MICRO_INTRADAY: 0 → 2 → 5 pips  
  - INTRADAY: 0 → 3 → 7 pips

  ## Impact
  This will immediately fix auto-execution for all monitored entry intents.
  Server will now execute when price enters the ACTUAL zone, not a bloated 60+ pip zone.
*/

-- Drop and recreate the function with corrected values
DROP FUNCTION IF EXISTS get_entry_time_thresholds(text);

CREATE OR REPLACE FUNCTION get_entry_time_thresholds(p_trade_style text)
RETURNS TABLE (
  optimal_wait_min integer,
  acceptable_wait_min integer,
  max_wait_min integer,
  eqs_phase2_min integer,
  eqs_phase3_min integer,
  eqs_threshold_phase1 integer,
  eqs_threshold_phase2 integer,
  eqs_threshold_phase3 integer,
  zone_tolerance_phase1 integer,
  zone_tolerance_phase2 integer,
  zone_tolerance_phase3 integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Time windows (unchanged)
    CASE p_trade_style
      WHEN 'SCALP' THEN 3
      WHEN 'MICRO_INTRADAY' THEN 15
      WHEN 'INTRADAY' THEN 45
      ELSE 15
    END AS optimal_wait_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 7
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY' THEN 90
      ELSE 30
    END AS acceptable_wait_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 10
      WHEN 'MICRO_INTRADAY' THEN 45
      WHEN 'INTRADAY' THEN 120
      ELSE 45
    END AS max_wait_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 3
      WHEN 'MICRO_INTRADAY' THEN 15
      WHEN 'INTRADAY' THEN 45
      ELSE 15
    END AS eqs_phase2_min,
    CASE p_trade_style
      WHEN 'SCALP' THEN 7
      WHEN 'MICRO_INTRADAY' THEN 30
      WHEN 'INTRADAY' THEN 90
      ELSE 30
    END AS eqs_phase3_min,
    
    -- EQS thresholds (unchanged)
    CASE p_trade_style
      WHEN 'SCALP' THEN 70
      WHEN 'MICRO_INTRADAY' THEN 65
      WHEN 'INTRADAY' THEN 60
      ELSE 65
    END AS eqs_threshold_phase1,
    CASE p_trade_style
      WHEN 'SCALP' THEN 60
      WHEN 'MICRO_INTRADAY' THEN 55
      WHEN 'INTRADAY' THEN 50
      ELSE 55
    END AS eqs_threshold_phase2,
    CASE p_trade_style
      WHEN 'SCALP' THEN 50
      WHEN 'MICRO_INTRADAY' THEN 45
      WHEN 'INTRADAY' THEN 40
      ELSE 45
    END AS eqs_threshold_phase3,
    
    -- FIXED: Zone tolerance in PIPS (was 10-20x too high)
    CASE p_trade_style
      WHEN 'SCALP' THEN 0
      WHEN 'MICRO_INTRADAY' THEN 0
      WHEN 'INTRADAY' THEN 0
      ELSE 0
    END AS zone_tolerance_phase1,
    CASE p_trade_style
      WHEN 'SCALP' THEN 1           -- was 20, now 1 pip
      WHEN 'MICRO_INTRADAY' THEN 2  -- was 30, now 2 pips
      WHEN 'INTRADAY' THEN 3        -- was 40, now 3 pips
      ELSE 2
    END AS zone_tolerance_phase2,
    CASE p_trade_style
      WHEN 'SCALP' THEN 2           -- was 40, now 2 pips
      WHEN 'MICRO_INTRADAY' THEN 5  -- was 60, now 5 pips
      WHEN 'INTRADAY' THEN 7        -- was 80, now 7 pips
      ELSE 5
    END AS zone_tolerance_phase3;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_entry_time_thresholds TO authenticated;
GRANT EXECUTE ON FUNCTION get_entry_time_thresholds TO service_role;

COMMENT ON FUNCTION get_entry_time_thresholds IS 
'FIXED: Returns time-decay thresholds with CORRECT zone tolerance values in pips (not 10-20x inflated)';
